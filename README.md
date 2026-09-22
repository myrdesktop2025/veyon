# Veyon Web 控制端

这是一个基于浏览器的 Veyon 远程控制界面，无需安装任何客户端软件，直接在浏览器中即可管理教室电脑。

## 功能特性

- ✅ 查看所有教室的计算机列表
- ✅ 发送文本消息到指定计算机
- ✅ 远程锁定/解锁计算机屏幕
- ✅ 远程重启计算机
- ✅ 远程关闭计算机
- ✅ 远程唤醒计算机（需要支持 Wake-on-LAN）
- ✅ 响应式设计，支持手机和平板访问

## 系统要求

- **操作系统**: Windows（安装了 Veyon）
- **Python**: 3.8 或更高版本
- **Veyon**: 已正确安装并配置

## 安装步骤

### 1. 安装 Python 依赖

```bash
pip install -r requirements.txt
```

### 2. 确认 Veyon 安装路径

确保 Veyon 已安装在默认路径 `C:\Program Files\Veyon\`，如果安装在不同位置，请修改 `app.py` 中的路径：

```python
cmd = ['C:\\Program Files\\Veyon\\veyon-cli.exe'] + args
```

改为实际路径，例如：
```python
cmd = ['D:\\Veyon\\veyon-cli.exe'] + args
```

### 3. 启动服务

```bash
python app.py
```

### 4. 访问 Web 界面

打开浏览器访问：http://localhost:5000

如果要让局域网内其他设备访问，可以使用本机 IP 地址，例如：http://192.168.1.100:5000

## 使用说明

### 查看计算机列表
页面会自动加载所有已配置的教室和计算机。

### 发送消息
1. 点击任意计算机的"发消息"按钮
2. 在弹窗中输入消息内容
3. 点击"发送"或按回车键

### 锁定/解锁计算机
点击"锁定"按钮可锁定指定计算机的屏幕，学生将无法操作。

### 重启/关机
- 点击"重启"按钮可远程重启计算机
- 点击"关机"按钮可远程关闭计算机（会有二次确认）

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/computers` | GET | 获取计算机列表 |
| `/api/message` | POST | 发送消息 |
| `/api/lock` | POST | 锁定计算机 |
| `/api/unlock` | POST | 解锁计算机 |
| `/api/shutdown` | POST | 关闭计算机 |
| `/api/reboot` | POST | 重启计算机 |
| `/api/wake` | POST | 唤醒计算机 |

### 请求示例

```bash
# 发送消息
curl -X POST http://localhost:5000/api/message \
  -H "Content-Type: application/json" \
  -d '{"computer": "A01", "message": "请保持安静"}'

# 关机
curl -X POST http://localhost:5000/api/shutdown \
  -H "Content-Type: application/json" \
  -d '{"computer": "A01"}'
```

## 生产环境部署

开发环境使用 Flask 内置服务器，生产环境建议使用 Gunicorn 或 uWSGI：

### 使用 Gunicorn（Windows 需使用 wsgidav 或其他 WSGI 服务器）

```bash
pip install gunicorn
gunicorn -w 4 -b 0.0.0.0:5000 app:app
```

### 使用 Nginx 反向代理（可选）

配置 Nginx 反向代理到 Flask 应用，提供更好的性能和安全性。

## 注意事项

1. **权限要求**: 运行此服务的用户需要有执行 veyon-cli 的权限
2. **网络配置**: 确保控制端和被控端网络连通，防火墙已放行 Veyon 端口
3. **认证密钥**: 确保已正确配置 Veyon 的访问密钥
4. **安全性**: 生产环境请添加用户认证机制，避免未授权访问

## 故障排查

### 问题：提示"未找到 veyon-cli"
- 确认 Veyon 已正确安装
- 检查 app.py 中的路径配置是否正确

### 问题：命令执行失败
- 在命令行手动测试：`veyon-cli networkobjects list`
- 检查 Veyon 服务是否正常运行
- 查看 Veyon 日志文件

### 问题：无法控制某些计算机
- 确认目标计算机的 Veyon 服务已启动
- 检查网络连接和防火墙设置
- 确认访问密钥配置正确

## 许可证

本项目基于 Veyon 官方命令行工具开发，遵循相应的开源协议。