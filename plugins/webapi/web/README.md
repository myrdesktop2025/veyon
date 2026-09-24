# Veyon Web - 浏览器端课堂管理界面

本目录为 Veyon WebAPI 插件内置的 Web 前端。启用 WebAPI 插件后，教师可直接在浏览器中监控与控制教室电脑，无需安装桌面客户端。

## 功能

- **主机监控**：以网格形式实时显示所有主机的画面缩略图（来自网络目录 `computers.json` / LDAP 等配置）
- **主机详情**：点击任意主机可查看大画面、会话信息与当前登录用户
- **远程操作**：锁屏 / 解锁、锁定输入、发送消息、注销用户、重启、关机，以及服务端注册的全部功能
- **手动添加主机**：网络目录为空时，可手动输入 IP / 主机名进行监控
- **自动发现**：每 30 秒自动刷新网络目录，新上线的主机会自动加入监控

## 如何启用

1. 构建 Veyon 时启用 WebAPI 插件：

   ```sh
   cmake -DWITH_WEBAPI=ON ...
   ```

2. 在教师机上以服务模式运行 Veyon 服务端（`veyon-server`），并在配置中启用 HTTP API 服务
   （默认端口 `11080`，可在 WebAPI 插件配置页修改）。

3. 浏览器访问：

   ```
   http://<教师机IP>:11080/
   ```

## 认证方式

WebAPI 使用与桌面客户端相同的认证机制，登录界面支持两种方式：

- **账号密码登录**：使用客户端机器上的用户凭据（对应 Veyon 的 `Logon` 认证方法）
- **Veyon 密钥文件登录**：粘贴教师私钥文件内容（`/etc/veyon/keys/private/<名称>/key`），
  对应 Veyon 的 `KeyFile` 认证方法

每个主机独立建立连接并持有各自的 `Connection-Uid`。

## API 说明

本前端依赖以下 WebAPI 接口（均为本插件提供）：

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/v1/hosts` | GET | 列出网络目录中的主机（新增） |
| `/api/v1/hoststate/<host>` | GET | 主机在线状态 |
| `/api/v1/authentication/<host>` | GET/POST/DELETE | 获取认证方式 / 建立连接 / 关闭连接 |
| `/api/v1/framebuffer` | GET | 获取主机画面（PNG） |
| `/api/v1/feature` | GET | 列出可用功能 |
| `/api/v1/feature/<uid>` | GET/PUT | 查询 / 启停功能 |
| `/api/v1/session`、`/api/v1/user` | GET | 会话与用户信息 |

## 开发说明

- 前端为纯静态资源（无构建步骤），随插件通过 Qt 资源系统（`webapi.qrc`）打包进插件动态库
- 服务端静态路由注册于 `WebApiHttpServer::start()`，页面入口 `/`，脚本 `/app.js`，样式 `/style.css`
- 主机列表接口实现位于 `WebApiController::listHosts()`，遍历网络对象目录中所有 `Host` 节点
