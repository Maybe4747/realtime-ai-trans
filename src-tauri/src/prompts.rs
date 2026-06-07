const TRANSLATION_SYSTEM: &str = include_str!("prompts/translation_system.md");

pub fn translation_system_prompt(source_language: &str, target_language: &str) -> String {
    TRANSLATION_SYSTEM
        .replace("{{source_language}}", language_name(source_language))
        .replace("{{target_language}}", language_name(target_language))
}

fn language_name(code: &str) -> &'static str {
    match code {
        "auto" => "自动识别",
        "en" => "英文",
        "zh-CN" => "简体中文",
        "zh-TW" => "繁体中文",
        "ja" => "日文",
        "ko" => "韩文",
        "es" => "西班牙文",
        "fr" => "法文",
        "de" => "德文",
        _ => "目标语言",
    }
}
