/**
 * 旧版（v1）系统路径/注册表常量
 * @description 旧版清理（legacyCleanupService）与系统残留扫描（residueScanService）
 * 共用的常量集中于此，避免服务之间互相 import 造成耦合与常量分叉。
 */

/** 旧版应用名（v1 userData 目录名候选：打包版大写 Prism、开发模式小写 prism） */
export const LEGACY_DIR_NAMES = ['Prism', 'prism'] as const

/** Windows 开机自启注册表键（v1 由 app.setLoginItemSettings 写入 Run 值） */
export const WIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
/** Windows 右键菜单集成注册表键（v1 shellIntegrationService 写入） */
export const WIN_SHELL_KEY = 'HKCU\\Software\\Classes\\*\\shell\\ShareWithPrism'
/** macOS 右键菜单集成工作流（v1 shellIntegrationService 写入） */
export const MAC_SERVICES_WORKFLOW_NAME = '分享到妙妙屋.workflow'
