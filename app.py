#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Veyon Web 控制端 - Flask 后端服务
通过调用 veyon-cli 实现浏览器远程控制教室电脑
"""

import json
import subprocess
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


def run_veyon_command(args):
    """执行 veyon-cli 命令并返回结果"""
    try:
        # Windows 系统上 veyon-cli 的完整路径（根据实际情况调整）
        cmd = ['C:\\Program Files\\Veyon\\veyon-cli.exe'] + args
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
        )
        
        return {
            'success': result.returncode == 0,
            'stdout': result.stdout.strip(),
            'stderr': result.stderr.strip(),
            'returncode': result.returncode
        }
    except FileNotFoundError:
        return {
            'success': False,
            'error': '未找到 veyon-cli，请确认 Veyon 已正确安装',
            'returncode': -1
        }
    except subprocess.TimeoutExpired:
        return {
            'success': False,
            'error': '命令执行超时',
            'returncode': -2
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'returncode': -3
        }


@app.route('/')
def index():
    """主页"""
    return render_template('index.html')


@app.route('/api/computers')
def get_computers():
    """获取计算机列表"""
    result = run_veyon_command(['networkobjects', 'list'])
    
    if not result['success']:
        return jsonify([])
    
    # 解析输出
    computers_data = []
    current_location = None
    current_computers = []
    
    for line in result['stdout'].split('\n'):
        line = line.strip()
        if not line:
            continue
            
        if line.startswith('地点'):
            # 保存之前的位置
            if current_location and current_computers:
                computers_data.append({
                    'name': current_location,
                    'computers': current_computers
                })
            
            # 提取位置名称
            current_location = line.split('"')[1] if '"' in line else line.replace('地点', '').strip()
            current_computers = []
            
        elif line.startswith('计算机'):
            # 提取计算机信息
            parts = line.split('"')
            if len(parts) >= 4:
                name = parts[1]
                ip = parts[3] if len(parts) > 3 else ''
                current_computers.append({
                    'name': name,
                    'ip': ip
                })
    
    # 添加最后一个位置
    if current_location and current_computers:
        computers_data.append({
            'name': current_location,
            'computers': current_computers
        })
    
    return jsonify(computers_data)


@app.route('/api/message', methods=['POST'])
def send_message():
    """发送消息到指定计算机"""
    data = request.json
    computer = data.get('computer')
    message = data.get('message')
    
    if not computer or not message:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    # 使用 feature start TextMessage 功能
    message_json = json.dumps({'text': message})
    result = run_veyon_command([
        'feature', 'start', computer, 'TextMessage', message_json
    ])
    
    if result['success']:
        return jsonify({'success': True})
    else:
        return jsonify({
            'success': False,
            'error': result.get('stderr', result.get('error', '未知错误'))
        })


@app.route('/api/lock', methods=['POST'])
def lock_computer():
    """锁定指定计算机"""
    data = request.json
    computer = data.get('computer')
    
    if not computer:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    result = run_veyon_command(['power', 'lock', computer])
    
    if result['success']:
        return jsonify({'success': True})
    else:
        return jsonify({
            'success': False,
            'error': result.get('stderr', result.get('error', '未知错误'))
        })


@app.route('/api/unlock', methods=['POST'])
def unlock_computer():
    """解锁指定计算机"""
    data = request.json
    computer = data.get('computer')
    
    if not computer:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    result = run_veyon_command(['power', 'unlock', computer])
    
    if result['success']:
        return jsonify({'success': True})
    else:
        return jsonify({
            'success': False,
            'error': result.get('stderr', result.get('error', '未知错误'))
        })


@app.route('/api/shutdown', methods=['POST'])
def shutdown_computer():
    """关闭指定计算机"""
    data = request.json
    computer = data.get('computer')
    
    if not computer:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    result = run_veyon_command(['power', 'off', computer])
    
    if result['success']:
        return jsonify({'success': True})
    else:
        return jsonify({
            'success': False,
            'error': result.get('stderr', result.get('error', '未知错误'))
        })


@app.route('/api/reboot', methods=['POST'])
def reboot_computer():
    """重启指定计算机"""
    data = request.json
    computer = data.get('computer')
    
    if not computer:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    result = run_veyon_command(['power', 'reboot', computer])
    
    if result['success']:
        return jsonify({'success': True})
    else:
        return jsonify({
            'success': False,
            'error': result.get('stderr', result.get('error', '未知错误'))
        })


@app.route('/api/wake', methods=['POST'])
def wake_computer():
    """唤醒指定计算机（需要支持 Wake-on-LAN）"""
    data = request.json
    computer = data.get('computer')
    
    if not computer:
        return jsonify({'success': False, 'error': '缺少参数'})
    
    result = run_veyon_command(['power', 'on', computer])
    
    if result['success']:
        return jsonify({'success': True})
    else:
        return jsonify({
            'success': False,
            'error': result.get('stderr', result.get('error', '未知错误'))
        })


if __name__ == '__main__':
    print("=" * 60)
    print("Veyon Web 控制端启动中...")
    print("=" * 60)
    print("访问地址：http://localhost:5000")
    print("按 Ctrl+C 停止服务")
    print("=" * 60)
    
    # 生产环境建议使用 gunicorn 或 uwsgi
    # 开发环境直接运行
    app.run(host='0.0.0.0', port=5000, debug=True)
