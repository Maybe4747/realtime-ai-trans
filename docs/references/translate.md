> ## Documentation Index
>
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 通用翻译

翻译 API 接口提供基于大模型的多语言翻译服务，包含通用翻译、转述翻译、两步翻译和三关翻译等多种翻译策略。支持自动语言检测、术语表定制、翻译建议和流式输出等特色功能。您只需要通过调用翻译 API，传入待处理的文本，并指定源语言（支持自动检测）和目标语言，即可获得高质量的翻译结果。

<CardGroup cols={2}>
  <Card title="详细说明" icon={<svg style={{maskImage: "url(https://mintcdn.com/zhipu-ef7018ed/6jZAOYw-eXEZh1pv/resource/icon/book.svg?fit=max&auto=format&n=6jZAOYw-eXEZh1pv&q=85&s=f9a867079d7ff6967277ded330e6a683)", maskRepeat: "no-repeat", maskPosition: "center center",}} className={"h-6 w-6 bg-primary dark:bg-primary-light !m-0 shrink-0"}/>} href="https://www.bigmodel.cn/marketplace/agent_detail/d8a2a4865b3f">
    查看介绍、核心功能、适用场景
  </Card>

<Card title=" Agent API 文档" icon={<svg style={{maskImage: "url(https://mintcdn.com/zhipu-ef7018ed/6jZAOYw-eXEZh1pv/resource/icon/code.svg?fit=max&auto=format&n=6jZAOYw-eXEZh1pv&q=85&s=2f67130d1597ee0b68135487ec31662f)", maskRepeat: "no-repeat", maskPosition: "center center",}} className={"h-6 w-6 bg-primary dark:bg-primary-light !m-0 shrink-0"}/>} href="/api-reference/agent-api/%E6%99%BA%E8%83%BD%E4%BD%93%E5%AF%B9%E8%AF%9D">
查看完整的 API 文档
</Card>

<Card title="体验中心" icon={<svg style={{maskImage: "url(https://mintcdn.com/zhipu-ef7018ed/6jZAOYw-eXEZh1pv/resource/icon/star.svg?fit=max&auto=format&n=6jZAOYw-eXEZh1pv&q=85&s=b3c8448dccf8f96abadf9a72e51b3cca)", maskRepeat: "no-repeat", maskPosition: "center center",}} className={"h-6 w-6 bg-primary dark:bg-primary-light !m-0 shrink-0"}/>} href="https://www.bigmodel.cn/trialcenter/agent?agentId=general_translation">
点击立即体验
</Card>
</CardGroup>

## **价格**

- **按 Token 后付费，20 元/百万 Tokens**
- 计量范围：智能体全任务流节点产生的 Tokens 总数

## **接口请求**

| 传输方式     | https                                                                            |
| :----------- | :------------------------------------------------------------------------------- |
| 请求地址     | [https://open.bigmodel.cn/api/v1/agents](https://open.bigmodel.cn/api/v1/agents) |
| 调用方式     | 同步调用，等待模型完成执行并返回最终结果或使用SSE调用                            |
| 字符编码     | UTF-8                                                                            |
| 接口请求格式 | JSON                                                                             |
| 响应格式     | JSON 或标准 Stream Event                                                         |
| 接口请求类型 | POST                                                                             |
| 开发语言     | 任意可发起 http 请求的开发语言                                                   |

## **请求参数**

| **参数名称**           | **类型**      | **是否必填** | **参数说明**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :--------------------- | :------------ | :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| agent_id               | String        | 是           | 智能体 ID：`general_translation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| stream                 | Boolean       | 否           | 使用同步调用时，此参数应当设置为 fasle 或者省略。表示模型生成完所有内容后一次性返回所有内容。默认值为 false。 如果设置为 true，模型将通过标准 Event Stream ，逐块返回模型生成内容。Event Stream 结束时会返回一条data: \[DONE]消息。 注意：在模型流式输出生成内容的过程中，我们会分批对模型生成内容进行检测，当检测到违法及不良信息时，API会返回错误码（1301）。开发者识别到错误码（1301），应及时采取（清屏、重启对话）等措施删除生成内容，并确保不将含有违法及不良信息的内容传递给模型继续生成，避免其造成负面影响 |
| messages               | List\<Object> | 是           | 会话消息体                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| └─ role                | String        | 是           | 用户的输入 `role = user`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| content                | List\<Object> | 是           | 会话消息体                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| └─ type                | String        | 是           | 目前支持 `type=text`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| └─ text                | String        | 是           | 用户输入的文本内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| custom_variables       | Object        | 否           | 智能体扩展参数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| └─ source_lang         | String        | 否           | 待翻译文本的源语言代码，默认值为 `auto`。可选值：<br />• `auto`（自动检测语种）<br />• 其他语种列表：详见语种代码表                                                                                                                                                                                                                                                                                                                                                                                                 |
| └─ target_lang         | String        | 否           | 待翻译文本的目标语言代码，默认为 `zh`。可选值：<br />• `zh`（中文）<br />• 其他语种列表：详见语种代码表                                                                                                                                                                                                                                                                                                                                                                                                             |
| └─ glossary            | String        | 否           | 术语表id，即通过文件上传接口获取的 file_id                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| └─ strategy            | String        | 否           | 翻译策略，默认 `general`。可选值：<br />• `general`（通用翻译）<br />• `paraphrase`（转述翻译）<br />• `two_step`（两步翻译）<br />• `three_step`（三步翻译）<br />• `reflection`（反思翻译）<br />• `cot`（COT翻译）                                                                                                                                                                                                                                                                                               |
| └─ strategy_config     | Object        | 否           | 翻译策略对应的参数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|     └─ general         | Object        | 否           | 当翻译策略指定为 `general` 时生效                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|         └─ suggestion  | String        | 否           | 翻译建议或风格要求，如术语对照、文体规范等                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
|     └─ cot             | Object        | 否           | 当翻译策略指定为 `cot` 时生效                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
|         └─ reason_lang | String        | 否           | 翻译理由的语言，取值 `from` 或 `to`，默认 `to`                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## **响应内容**

| **参数名称**         | **类型** | **参数说明**                                                                                                                                                                                                                                                                             |
| :------------------- | :------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                   | String   | 任务 ID                                                                                                                                                                                                                                                                                  |
| agent_id             | String   | 智能体 ID                                                                                                                                                                                                                                                                                |
| choices              | List     | 当前对话的模型输出内容                                                                                                                                                                                                                                                                   |
| index                | Integer  | 结果下标                                                                                                                                                                                                                                                                                 |
| finish_reason        | String   | 模型推理终止的原因。枚举值：<br />• `stop`（推理自然结束或触发停止词）<br />• `tool_calls`（模型命中函数）<br />• `length`（到达 tokens 长度上限）<br />• `sensitive`（模型推理内容被安全审核接口拦截，请用户自行判断并决定是否撤回已公开的内容）<br />• `network_error`（模型推理异常） |
| message              | Object   | 模型返回的文本信息                                                                                                                                                                                                                                                                       |
| └─ role              | String   | 当前对话的角色，目前默认为 `assistant`（模型）                                                                                                                                                                                                                                           |
| content              | Object   | 当前对话的推理结果。                                                                                                                                                                                                                                                                     |
| └─ type              | String   | 当前对话的推理结果类型                                                                                                                                                                                                                                                                   |
| └─ text              | String   | 当前对话的推理结果内容                                                                                                                                                                                                                                                                   |
| usage                | Object   | 模型调用结束时返回的 tokens 使用统计。                                                                                                                                                                                                                                                   |
| └─ prompt_tokens     | Integer  | 用户输入的 tokens 数量                                                                                                                                                                                                                                                                   |
| └─ completion_tokens | Integer  | 模型输出的 tokens 数量                                                                                                                                                                                                                                                                   |
| └─ total_tokens      | Integer  | 总 tokens 数量                                                                                                                                                                                                                                                                           |

## **支持的语种列表**

- 源语言列表

| 语言代码 | 中文名称     |
| :------- | :----------- |
| auto     | 自动检测     |
| zh-CN    | 简体中文     |
| zh-TW    | 繁体中文     |
| wyw      | 文言文       |
| yue      | 粤语         |
| en       | 英语         |
| ja       | 日语         |
| ko       | 韩语         |
| fr       | 法语         |
| de       | 德语         |
| es       | 西班牙语     |
| ru       | 俄语         |
| pt       | 葡萄牙语     |
| it       | 意大利语     |
| ar       | 阿拉伯语     |
| hi       | 印地语       |
| bg       | 保加利亚语   |
| cs       | 捷克语       |
| da       | 丹麦语       |
| el       | 希腊语       |
| et       | 爱沙尼亚语   |
| fi       | 芬兰语       |
| hu       | 匈牙利语     |
| id       | 印尼语       |
| lt       | 立陶宛语     |
| lv       | 拉脱维亚语   |
| nl       | 荷兰语       |
| no       | 书面挪威语   |
| pl       | 波兰语       |
| ro       | 罗马尼亚语   |
| sk       | 斯洛伐克语   |
| sl       | 斯洛文尼亚语 |
| sv       | 瑞典语       |
| th       | 泰语         |
| tr       | 土耳其语     |
| uk       | 乌克兰语     |
| vi       | 越南语       |
| my       | 缅甸语       |
| ms       | 马来语       |
| Pinyin   | 拼音         |
| IPA      | 国际音标     |

- 目标语言列表

| 语言代码 | 中文名称     |
| :------- | :----------- |
| zh-CN    | 简体中文     |
| zh-TW    | 繁体中文     |
| wyw      | 文言文       |
| yue      | 粤语         |
| en       | 英语         |
| en-GB    | 英语（英国） |
| en-US    | 英语（美国） |
| ja       | 日语         |
| ko       | 韩语         |
| fr       | 法语         |
| de       | 德语         |
| es       | 西班牙语     |
| ru       | 俄语         |
| pt       | 葡萄牙语     |
| it       | 意大利语     |
| ar       | 阿拉伯语     |
| hi       | 印地语       |
| bg       | 保加利亚语   |
| cs       | 捷克语       |
| da       | 丹麦语       |
| el       | 希腊语       |
| et       | 爱沙尼亚语   |
| fi       | 芬兰语       |
| hu       | 匈牙利语     |
| id       | 印尼语       |
| lt       | 立陶宛语     |
| lv       | 拉脱维亚语   |
| nl       | 荷兰语       |
| no       | 书面挪威语   |
| pl       | 波兰语       |
| ro       | 罗马尼亚语   |
| sk       | 斯洛伐克语   |
| sl       | 斯洛文尼亚语 |
| sv       | 瑞典语       |
| th       | 泰语         |
| tr       | 土耳其语     |
| uk       | 乌克兰语     |
| vi       | 越南语       |
| my       | 缅甸语       |
| ms       | 马来语       |
| Pinyin   | 拼音         |
| IPA      | 国际音标     |
