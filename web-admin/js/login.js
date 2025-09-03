// web-admin/js/login.js
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const loginBtn = document.getElementById('loginBtn');
    const errorAlert = document.getElementById('errorAlert');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const loginText = document.getElementById('loginText');
    
    // 检查是否已登录
    const token = localStorage.getItem('authToken');
    if (token) {
        // 验证token是否有效
        fetch('/api/auth/verify', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        })
        .then(response => {
            if (!response.ok) throw new Error('Token invalid');
            return response.json();
        })
        .then(data => {
            if (data.valid) {
                // 已登录，跳转到主页
                window.location.href = 'index.html';
            } else {
                // token无效，清除本地存储
                localStorage.removeItem('authToken');
                localStorage.removeItem('user');
            }
        })
        .catch(error => {
            console.error('Token verification failed:', error);
            // 清除无效的token
            localStorage.removeItem('authToken');
            localStorage.removeItem('user');
        });
    }
    
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault(); // 阻止表单默认提交行为
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        if (!username || !password) {
            showError('请输入用户名和密码');
            return;
        }
        
        // 显示加载状态
        loadingSpinner.classList.remove('hidden');
        loginText.textContent = '登录中...';
        loginBtn.disabled = true;
        errorAlert.style.display = 'none';
        
        try {
            // 发送登录请求
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            // 检查响应状态
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
            }
            
            const data = await response.json();
            
            if (data.error) {
                showError(data.error);
            } else {
                // 保存token和用户信息
                localStorage.setItem('authToken', data.token);
                localStorage.setItem('user', JSON.stringify(data.user));
                
                // 跳转到主页
                window.location.href = 'index.html';
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('登录失败: ' + (error.message || '网络错误，请稍后重试'));
        } finally {
            // 隐藏加载状态
            loadingSpinner.classList.add('hidden');
            loginText.textContent = '登录';
            loginBtn.disabled = false;
        }
    });
    
    function showError(message) {
        errorAlert.textContent = message;
        errorAlert.style.display = 'block';
        
        // 5秒后自动隐藏错误信息
        setTimeout(() => {
            errorAlert.style.display = 'none';
        }, 5000);
    }
});