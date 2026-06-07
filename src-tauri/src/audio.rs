use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::asr;
use crate::db::{self, AppConfig};
use crate::translate;

const DST_RATE: usize = 16_000;
#[cfg(target_os = "macos")]
const SRC_RATE: usize = 48_000;

const FRAME: usize = 320;
const SILENCE_RMS: f32 = 0.008;
const SILENCE_HANG: usize = 18;
const MIN_SEG: usize = DST_RATE * 3 / 10;
const MAX_SEG: usize = DST_RATE * 8;

struct Vad {
    seg: Vec<f32>,
    frame: Vec<f32>,
    silence: usize,
    in_speech: bool,
    decim_acc: f32,
    decim_n: usize,
    resample_acc: usize,
    tx: Sender<Vec<f32>>,
}

impl Vad {
    fn push_sample(&mut self, sample: f32, sample_rate: usize) {
        if sample_rate == DST_RATE {
            self.push_16k(sample);
            return;
        }

        if sample_rate > DST_RATE {
            let step = sample_rate / DST_RATE;
            self.decim_acc += sample;
            self.decim_n += 1;
            if sample_rate % DST_RATE == 0 && self.decim_n >= step {
                self.push_16k(self.decim_acc / self.decim_n as f32);
                self.decim_acc = 0.0;
                self.decim_n = 0;
            } else if sample_rate % DST_RATE != 0 {
                self.resample_acc += DST_RATE;
                if self.resample_acc >= sample_rate {
                    self.resample_acc -= sample_rate;
                    self.push_16k(self.decim_acc / self.decim_n as f32);
                    self.decim_acc = 0.0;
                    self.decim_n = 0;
                }
            }
        }
    }

    fn push_16k(&mut self, sample: f32) {
        self.frame.push(sample);
        if self.frame.len() < FRAME {
            return;
        }

        let rms = (self.frame.iter().map(|x| x * x).sum::<f32>() / FRAME as f32).sqrt();
        let voiced = rms > SILENCE_RMS;

        if voiced {
            self.in_speech = true;
            self.silence = 0;
            self.seg.extend_from_slice(&self.frame);
        } else if self.in_speech {
            self.silence += 1;
            self.seg.extend_from_slice(&self.frame);
            if self.silence >= SILENCE_HANG {
                self.flush();
            }
        }

        if self.seg.len() >= MAX_SEG {
            self.flush();
        }
        self.frame.clear();
    }

    fn flush(&mut self) {
        if self.seg.len() >= MIN_SEG {
            let seg = std::mem::take(&mut self.seg);
            let _ = self.tx.send(seg);
        } else {
            self.seg.clear();
        }
        self.silence = 0;
        self.in_speech = false;
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureStateEvent {
    running: bool,
    message: String,
}

struct CaptureSession {
    #[cfg(target_os = "macos")]
    stream: screencapturekit::prelude::SCStream,
    #[cfg(target_os = "windows")]
    stop: Arc<AtomicBool>,
}

static SESSION: Mutex<Option<CaptureSession>> = Mutex::new(None);

pub fn is_running() -> bool {
    SESSION.lock().unwrap().is_some()
}

pub fn emit_capture_state(app: &AppHandle, message: impl Into<String>) {
    let _ = app.emit(
        "capture_state",
        CaptureStateEvent {
            running: is_running(),
            message: message.into(),
        },
    );
}

#[tauri::command]
pub fn start_capture(app: AppHandle) -> Result<(), String> {
    let mut guard = SESSION.lock().unwrap();
    if guard.is_some() {
        return Err("已在运行".into());
    }

    let config = validate_config(&app)?;
    let (tx, rx) = channel::<Vec<f32>>();
    spawn_processing_thread(&app, rx, &config);
    let vad = Arc::new(Mutex::new(Vad {
        seg: Vec::new(),
        frame: Vec::new(),
        silence: 0,
        in_speech: false,
        decim_acc: 0.0,
        decim_n: 0,
        resample_acc: 0,
        tx,
    }));

    let session = platform::start(vad, &app)?;
    *guard = Some(session);
    drop(guard);
    emit_capture_state(&app, platform::RUNNING_MESSAGE);
    Ok(())
}

#[tauri::command]
pub fn stop_capture(app: AppHandle) -> Result<(), String> {
    let session = {
        let mut guard = SESSION.lock().unwrap();
        guard.take().ok_or("当前未在运行")?
    };
    platform::stop(session)?;
    emit_capture_state(&app, "已停止");
    Ok(())
}

fn validate_config(app: &AppHandle) -> Result<AppConfig, String> {
    let config = db::load_config(app)?;
    if config.asr_provider != "zhipu_glm_asr" {
        return Err(format!("暂不支持 ASR provider: {}", config.asr_provider));
    }
    if config.llm_provider != "deepseek_v4_flash" {
        return Err(format!("暂不支持 LLM provider: {}", config.llm_provider));
    }
    if config.asr_api_key.trim().is_empty() {
        return Err("请先在设置中配置 ASR API key".to_string());
    }
    if config.llm_api_key.trim().is_empty() {
        return Err("请先在设置中配置 LLM translation API key".to_string());
    }
    Ok(config)
}

fn spawn_processing_thread(
    app: &AppHandle,
    rx: std::sync::mpsc::Receiver<Vec<f32>>,
    config: &AppConfig,
) {
    let app = app.clone();
    let asr_key = config.asr_api_key.trim().to_string();
    let translate_key = config.llm_api_key.trim().to_string();
    let source_language = config.source_language.clone();
    let target_language = config.target_language.clone();

    std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                eprintln!("[audio] 创建运行时失败: {e}");
                return;
            }
        };
        let client = reqwest::Client::new();
        rt.block_on(async move {
            let ctx: Arc<Mutex<Vec<(String, String)>>> = Arc::new(Mutex::new(Vec::new()));
            while let Ok(seg) = rx.recv() {
                if let Some((id, original)) = asr::transcribe(&app, &client, &asr_key, seg).await {
                    let app2 = app.clone();
                    let client2 = client.clone();
                    let key = translate_key.clone();
                    let ctx2 = ctx.clone();
                    let ctx_snapshot = ctx.lock().unwrap().clone();
                    let source_language = source_language.clone();
                    let target_language = target_language.clone();
                    tokio::spawn(async move {
                        if let Some(translated) = translate::translate(
                            &app2,
                            &client2,
                            &key,
                            id,
                            &original,
                            &ctx_snapshot,
                            &source_language,
                            &target_language,
                        )
                        .await
                        {
                            let mut ctx = ctx2.lock().unwrap();
                            ctx.push((original, translated));
                            let len = ctx.len();
                            if len > 3 {
                                ctx.drain(..len - 3);
                            }
                        }
                    });
                }
            }
        });
    });
}

#[cfg(target_os = "macos")]
mod platform {
    use super::*;
    use screencapturekit::prelude::*;

    pub const RUNNING_MESSAGE: &str = "正在同传系统音频";

    struct Capture {
        vad: Arc<Mutex<Vad>>,
    }

    impl SCStreamOutputTrait for Capture {
        fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
            if of_type != SCStreamOutputType::Audio {
                return;
            }
            let Some(list) = sample.audio_buffer_list() else {
                return;
            };
            let channels = list.num_buffers();
            if channels == 0 {
                return;
            }

            let channel_buffers: Vec<&[u8]> = list.iter().map(|b| b.data()).collect();
            let frames = channel_buffers[0].len() / 4;
            let mut vad = self.vad.lock().unwrap();
            for frame in 0..frames {
                let offset = frame * 4;
                let mut acc = 0.0f32;
                for channel in &channel_buffers {
                    if offset + 4 <= channel.len() {
                        acc += f32::from_le_bytes([
                            channel[offset],
                            channel[offset + 1],
                            channel[offset + 2],
                            channel[offset + 3],
                        ]);
                    }
                }
                vad.push_sample(acc / channels as f32, SRC_RATE);
            }
        }
    }

    pub fn start(vad: Arc<Mutex<Vad>>, _app: &AppHandle) -> Result<CaptureSession, String> {
        let content = SCShareableContent::get().map_err(|e| format!("获取共享内容失败: {e:?}"))?;
        let display = content
            .displays()
            .into_iter()
            .next()
            .ok_or("没有可用显示器")?;
        let filter = SCContentFilter::create()
            .with_display(&display)
            .with_excluding_windows(&[])
            .build();
        let config = SCStreamConfiguration::new()
            .with_width(2)
            .with_height(2)
            .with_captures_audio(true)
            .with_sample_rate(SRC_RATE as i32)
            .with_channel_count(2)
            .with_excludes_current_process_audio(true);

        let mut stream = SCStream::new(&filter, &config);
        stream.add_output_handler(Capture { vad }, SCStreamOutputType::Audio);
        stream
            .start_capture()
            .map_err(|e| format!("启动采集失败(检查屏幕录制权限): {e:?}"))?;

        Ok(CaptureSession { stream })
    }

    pub fn stop(session: CaptureSession) -> Result<(), String> {
        session
            .stream
            .stop_capture()
            .map_err(|e| format!("停止采集失败: {e:?}"))
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::ffi::c_void;
    use std::ptr::null_mut;
    use std::time::Duration;

    use windows_sys::core::{GUID, HRESULT};
    use windows_sys::Win32::Foundation::{E_NOINTERFACE, S_FALSE, S_OK};
    use windows_sys::Win32::Media::Audio::{
        eConsole, eRender, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, MMDeviceEnumerator, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    };
    use windows_sys::Win32::Media::KernelStreaming::KSDATAFORMAT_SUBTYPE_PCM;
    use windows_sys::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };

    pub const RUNNING_MESSAGE: &str = "正在同传 Windows 系统音频";

    const IID_IMM_DEVICE_ENUMERATOR: GUID = GUID::from_u128(0xa95664d2_9614_4f35_a746_de8db63617e6);
    const IID_IAUDIO_CLIENT: GUID = GUID::from_u128(0x1cb9ad4c_dbfa_4c32_b178_c2f568a703b2);
    const IID_IAUDIO_CAPTURE_CLIENT: GUID = GUID::from_u128(0xc8adbd64_e71e_48a0_a4de_185c395cd317);
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);
    const WAVE_FORMAT_PCM: u16 = 0x0001;
    const WAVE_FORMAT_IEEE_FLOAT: u16 = 0x0003;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xfffe;
    const BUFFER_DURATION_100NS: i64 = 1_000_000;

    #[repr(C)]
    struct UnknownVtbl {
        query_interface: unsafe extern "system" fn(ComPtr, *const GUID, *mut ComPtr) -> HRESULT,
        add_ref: unsafe extern "system" fn(ComPtr) -> u32,
        release: unsafe extern "system" fn(ComPtr) -> u32,
    }

    #[repr(C)]
    struct IMMDeviceEnumeratorVtbl {
        unknown: UnknownVtbl,
        enum_audio_endpoints: usize,
        get_default_audio_endpoint:
            unsafe extern "system" fn(ComPtr, i32, i32, *mut ComPtr) -> HRESULT,
    }

    #[repr(C)]
    struct IMMDeviceVtbl {
        unknown: UnknownVtbl,
        activate: unsafe extern "system" fn(
            ComPtr,
            *const GUID,
            u32,
            *const c_void,
            *mut ComPtr,
        ) -> HRESULT,
    }

    #[repr(C)]
    struct IAudioClientVtbl {
        unknown: UnknownVtbl,
        initialize: unsafe extern "system" fn(
            ComPtr,
            i32,
            u32,
            i64,
            i64,
            *const WAVEFORMATEX,
            *const GUID,
        ) -> HRESULT,
        get_buffer_size: usize,
        get_stream_latency: usize,
        get_current_padding: usize,
        is_format_supported: usize,
        get_mix_format: unsafe extern "system" fn(ComPtr, *mut *mut WAVEFORMATEX) -> HRESULT,
        get_device_period: usize,
        start: unsafe extern "system" fn(ComPtr) -> HRESULT,
        stop: unsafe extern "system" fn(ComPtr) -> HRESULT,
        reset: usize,
        set_event_handle: usize,
        get_service: unsafe extern "system" fn(ComPtr, *const GUID, *mut ComPtr) -> HRESULT,
    }

    #[repr(C)]
    struct IAudioCaptureClientVtbl {
        unknown: UnknownVtbl,
        get_buffer: unsafe extern "system" fn(
            ComPtr,
            *mut *mut u8,
            *mut u32,
            *mut u32,
            *mut u64,
            *mut u64,
        ) -> HRESULT,
        release_buffer: unsafe extern "system" fn(ComPtr, u32) -> HRESULT,
        get_next_packet_size: unsafe extern "system" fn(ComPtr, *mut u32) -> HRESULT,
    }

    type ComPtr = *mut c_void;

    pub fn start(vad: Arc<Mutex<Vad>>, app: &AppHandle) -> Result<CaptureSession, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let app = app.clone();
        let thread_stop = stop.clone();

        std::thread::spawn(move || {
            if let Err(e) = capture_loop(vad, thread_stop, &app) {
                emit_capture_state(&app, format!("错误: {e}"));
                let mut guard = SESSION.lock().unwrap();
                guard.take();
            }
        });

        Ok(CaptureSession { stop })
    }

    pub fn stop(session: CaptureSession) -> Result<(), String> {
        session.stop.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn capture_loop(
        vad: Arc<Mutex<Vad>>,
        stop: Arc<AtomicBool>,
        _app: &AppHandle,
    ) -> Result<(), String> {
        let _com = ComApartment::init()?;
        let enumerator = create_mm_device_enumerator()?;
        let device = get_default_render_device(enumerator.as_ptr())?;
        let audio_client = activate_audio_client(device.as_ptr())?;
        let format_ptr = get_mix_format(audio_client.as_ptr())?;
        let format = unsafe { MixFormat::from_ptr(format_ptr.as_ptr())? };

        unsafe {
            let hr = (audio_client_vtbl(audio_client.as_ptr()).initialize)(
                audio_client.as_ptr(),
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                BUFFER_DURATION_100NS,
                0,
                format_ptr.as_ptr(),
                std::ptr::null(),
            );
            check_hr(hr, "初始化 WASAPI loopback 失败")?;
        }

        let capture_client = get_capture_client(audio_client.as_ptr())?;

        unsafe {
            let hr = (audio_client_vtbl(audio_client.as_ptr()).start)(audio_client.as_ptr());
            check_hr(hr, "启动 WASAPI loopback 失败")?;
        }

        let result = read_loop(capture_client.as_ptr(), vad, stop, &format);

        unsafe {
            let _ = (audio_client_vtbl(audio_client.as_ptr()).stop)(audio_client.as_ptr());
        }
        result
    }

    fn read_loop(
        capture_client: ComPtr,
        vad: Arc<Mutex<Vad>>,
        stop: Arc<AtomicBool>,
        format: &MixFormat,
    ) -> Result<(), String> {
        while !stop.load(Ordering::SeqCst) {
            let mut packet_frames = 0u32;
            unsafe {
                let hr = (capture_client_vtbl(capture_client).get_next_packet_size)(
                    capture_client,
                    &mut packet_frames,
                );
                check_hr(hr, "读取 WASAPI packet size 失败")?;
            }

            if packet_frames == 0 {
                std::thread::sleep(Duration::from_millis(10));
                continue;
            }

            while packet_frames > 0 {
                let mut data: *mut u8 = null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                unsafe {
                    let hr = (capture_client_vtbl(capture_client).get_buffer)(
                        capture_client,
                        &mut data,
                        &mut frames,
                        &mut flags,
                        null_mut(),
                        null_mut(),
                    );
                    check_hr(hr, "读取 WASAPI buffer 失败")?;
                }

                if frames > 0 && flags & AUDCLNT_BUFFERFLAGS_SILENT as u32 == 0 {
                    push_audio_frames(data, frames, format, &vad)?;
                }

                unsafe {
                    let hr =
                        (capture_client_vtbl(capture_client).release_buffer)(capture_client, frames);
                    check_hr(hr, "释放 WASAPI buffer 失败")?;
                    let hr = (capture_client_vtbl(capture_client).get_next_packet_size)(
                        capture_client,
                        &mut packet_frames,
                    );
                    check_hr(hr, "读取 WASAPI packet size 失败")?;
                }
            }
        }
        Ok(())
    }

    fn push_audio_frames(
        data: *const u8,
        frames: u32,
        format: &MixFormat,
        vad: &Arc<Mutex<Vad>>,
    ) -> Result<(), String> {
        if data.is_null() {
            return Ok(());
        }

        let channels = format.channels as usize;
        if channels == 0 {
            return Err("Windows 音频通道数为 0".to_string());
        }

        let mut vad = vad.lock().unwrap();
        for frame in 0..frames as usize {
            let mut acc = 0.0f32;
            for channel in 0..channels {
                acc += unsafe { format.sample(data, frame, channel) };
            }
            vad.push_sample(acc / channels as f32, format.sample_rate as usize);
        }
        Ok(())
    }

    struct MixFormat {
        format_tag: u16,
        channels: u16,
        sample_rate: u32,
        bits_per_sample: u16,
        block_align: u16,
        sub_format: Option<GUID>,
    }

    impl MixFormat {
        unsafe fn from_ptr(ptr: *const WAVEFORMATEX) -> Result<Self, String> {
            if ptr.is_null() {
                return Err("WASAPI 未返回音频格式".to_string());
            }

            let wave = *ptr;
            let sub_format = if wave.wFormatTag == WAVE_FORMAT_EXTENSIBLE {
                Some((*(ptr as *const WAVEFORMATEXTENSIBLE)).SubFormat)
            } else {
                None
            };

            Ok(Self {
                format_tag: wave.wFormatTag,
                channels: wave.nChannels,
                sample_rate: wave.nSamplesPerSec,
                bits_per_sample: wave.wBitsPerSample,
                block_align: wave.nBlockAlign,
                sub_format,
            })
        }

        unsafe fn sample(&self, data: *const u8, frame: usize, channel: usize) -> f32 {
            let offset = frame * self.block_align as usize
                + channel * (self.bits_per_sample as usize / 8).max(1);
            let ptr = data.add(offset);

            if self.is_float() && self.bits_per_sample == 32 {
                return f32::from_le_bytes([*ptr, *ptr.add(1), *ptr.add(2), *ptr.add(3)]);
            }

            if self.is_pcm() {
                return match self.bits_per_sample {
                    16 => {
                        let sample = i16::from_le_bytes([*ptr, *ptr.add(1)]);
                        sample as f32 / i16::MAX as f32
                    }
                    24 => {
                        let raw = ((*ptr as i32)
                            | ((*ptr.add(1) as i32) << 8)
                            | ((*ptr.add(2) as i32) << 16))
                            << 8;
                        (raw >> 8) as f32 / 8_388_607.0
                    }
                    32 => {
                        let sample =
                            i32::from_le_bytes([*ptr, *ptr.add(1), *ptr.add(2), *ptr.add(3)]);
                        sample as f32 / i32::MAX as f32
                    }
                    _ => 0.0,
                };
            }

            0.0
        }

        fn is_float(&self) -> bool {
            self.format_tag == WAVE_FORMAT_IEEE_FLOAT
                || self
                    .sub_format
                    .is_some_and(|guid| guid_eq(guid, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT))
        }

        fn is_pcm(&self) -> bool {
            self.format_tag == WAVE_FORMAT_PCM
                || self
                    .sub_format
                    .is_some_and(|guid| guid_eq(guid, KSDATAFORMAT_SUBTYPE_PCM))
        }
    }

    fn guid_eq(left: GUID, right: GUID) -> bool {
        left.data1 == right.data1
            && left.data2 == right.data2
            && left.data3 == right.data3
            && left.data4 == right.data4
    }

    struct ComApartment;

    impl ComApartment {
        fn init() -> Result<Self, String> {
            let hr = unsafe { CoInitializeEx(std::ptr::null(), COINIT_MULTITHREADED as u32) };
            if hr != S_OK && hr != S_FALSE {
                return Err(format_hresult("初始化 COM 失败", hr));
            }
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }

    struct CoTaskMem<T> {
        ptr: *mut T,
    }

    impl<T> CoTaskMem<T> {
        fn as_ptr(&self) -> *mut T {
            self.ptr
        }
    }

    impl<T> Drop for CoTaskMem<T> {
        fn drop(&mut self) {
            if !self.ptr.is_null() {
                unsafe { CoTaskMemFree(self.ptr as *const c_void) };
            }
        }
    }

    struct ComObject {
        ptr: ComPtr,
    }

    impl ComObject {
        fn new(ptr: ComPtr) -> Result<Self, String> {
            if ptr.is_null() {
                return Err("Windows COM 返回空对象".to_string());
            }
            Ok(Self { ptr })
        }

        fn as_ptr(&self) -> ComPtr {
            self.ptr
        }
    }

    impl Drop for ComObject {
        fn drop(&mut self) {
            if !self.ptr.is_null() {
                unsafe {
                    let vtbl = *(self.ptr as *mut *mut UnknownVtbl);
                    ((*vtbl).release)(self.ptr);
                }
            }
        }
    }

    unsafe impl Send for ComObject {}

    fn create_mm_device_enumerator() -> Result<ComObject, String> {
        let mut ptr: ComPtr = null_mut();
        let hr = unsafe {
            CoCreateInstance(
                &MMDeviceEnumerator,
                null_mut(),
                CLSCTX_ALL,
                &IID_IMM_DEVICE_ENUMERATOR,
                &mut ptr,
            )
        };
        check_hr(hr, "创建 Windows 音频设备枚举器失败")?;
        ComObject::new(ptr)
    }

    fn get_default_render_device(enumerator: ComPtr) -> Result<ComObject, String> {
        let mut ptr: ComPtr = null_mut();
        let hr = unsafe {
            (device_enumerator_vtbl(enumerator).get_default_audio_endpoint)(
                enumerator,
                eRender,
                eConsole,
                &mut ptr,
            )
        };
        check_hr(hr, "获取默认 Windows 播放设备失败")?;
        ComObject::new(ptr)
    }

    fn activate_audio_client(device: ComPtr) -> Result<ComObject, String> {
        let mut ptr: ComPtr = null_mut();
        let hr = unsafe {
            (device_vtbl(device).activate)(
                device,
                &IID_IAUDIO_CLIENT,
                CLSCTX_ALL,
                std::ptr::null(),
                &mut ptr,
            )
        };
        check_hr(hr, "激活 Windows AudioClient 失败")?;
        ComObject::new(ptr)
    }

    fn get_mix_format(audio_client: ComPtr) -> Result<CoTaskMem<WAVEFORMATEX>, String> {
        let mut ptr: *mut WAVEFORMATEX = null_mut();
        let hr = unsafe { (audio_client_vtbl(audio_client).get_mix_format)(audio_client, &mut ptr) };
        check_hr(hr, "读取 Windows 音频格式失败")?;
        if ptr.is_null() {
            return Err("WASAPI 返回空音频格式".to_string());
        }
        Ok(CoTaskMem { ptr })
    }

    fn get_capture_client(audio_client: ComPtr) -> Result<ComObject, String> {
        let mut ptr: ComPtr = null_mut();
        let hr = unsafe {
            (audio_client_vtbl(audio_client).get_service)(
                audio_client,
                &IID_IAUDIO_CAPTURE_CLIENT,
                &mut ptr,
            )
        };
        check_hr(hr, "获取 Windows CaptureClient 失败")?;
        ComObject::new(ptr)
    }

    unsafe fn device_enumerator_vtbl(ptr: ComPtr) -> &'static IMMDeviceEnumeratorVtbl {
        &**(ptr as *mut *mut IMMDeviceEnumeratorVtbl)
    }

    unsafe fn device_vtbl(ptr: ComPtr) -> &'static IMMDeviceVtbl {
        &**(ptr as *mut *mut IMMDeviceVtbl)
    }

    unsafe fn audio_client_vtbl(ptr: ComPtr) -> &'static IAudioClientVtbl {
        &**(ptr as *mut *mut IAudioClientVtbl)
    }

    unsafe fn capture_client_vtbl(ptr: ComPtr) -> &'static IAudioCaptureClientVtbl {
        &**(ptr as *mut *mut IAudioCaptureClientVtbl)
    }

    fn check_hr(hr: HRESULT, context: &str) -> Result<(), String> {
        if hr >= 0 {
            Ok(())
        } else if hr == E_NOINTERFACE {
            Err(format!("{context}: 不支持所需 Windows 音频接口"))
        } else {
            Err(format_hresult(context, hr))
        }
    }

    fn format_hresult(context: &str, hr: HRESULT) -> String {
        format!("{context}: HRESULT 0x{:08X}", hr as u32)
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::*;

    pub const RUNNING_MESSAGE: &str = "当前平台暂不支持系统音频采集";

    pub fn start(_vad: Arc<Mutex<Vad>>, _app: &AppHandle) -> Result<CaptureSession, String> {
        Err("当前平台暂不支持系统音频采集".to_string())
    }

    pub fn stop(_session: CaptureSession) -> Result<(), String> {
        Ok(())
    }
}
