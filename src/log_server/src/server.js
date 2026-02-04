/**
 * HTTPS 请求拦截日志服务器
 *
 * 功能：
 * 1. 接收来自 Android 拦截器的日志 (POST /api/log)
 * 2. 存储到 SQLite 数据库
 * 3. 通过 WebSocket 实时推送到网页前端
 * 4. 提供网页界面查看日志
 */

const express = require('express');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const http = require('http');
const path = require('path');
const fs = require('fs');

// 配置
const PORT = process.env.PORT || 8088;
const DB_PATH = path.join(__dirname, '../data/logs.db');

// 确保数据目录存在
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 数据库实例
let db = null;

// WebSocket 客户端集合
const wsClients = new Set();

// Express 应用
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// 初始化数据库
async function initDatabase() {
    const initSqlJs = require('sql.js');

    // 初始化 SQL.js
    const SQL = await initSqlJs();

    // 加载现有数据库或创建新数据库
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
        console.log('已加载现有数据库');
    } else {
        db = new SQL.Database();
        console.log('已创建新数据库');
    }

    // 创建表
    db.run(`
        CREATE TABLE IF NOT EXISTS http_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            received_at TEXT DEFAULT CURRENT_TIMESTAMP,
            method TEXT,
            url TEXT,
            protocol TEXT,
            status_code INTEGER,
            status_message TEXT,
            duration_ms INTEGER,
            request_headers TEXT,
            request_body TEXT,
            response_headers TEXT,
            response_body TEXT,
            error TEXT,
            token_detected INTEGER DEFAULT 0,
            token_info TEXT,
            raw_log TEXT
        )
    `);

    db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON http_logs(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_url ON http_logs(url)`);

    // 保存数据库
    saveDatabase();

    console.log('数据库初始化完成');
}

// 保存数据库到文件
function saveDatabase() {
    if (db) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

// 定期保存数据库
setInterval(saveDatabase, 10000);

// API: 接收日志
app.post('/api/log', (req, res) => {
    try {
        const log = req.body;

        // 解析并存储日志
        const logData = {
            timestamp: log.timestamp || new Date().toISOString(),
            method: log.method || '',
            url: log.url || '',
            protocol: log.protocol || '',
            statusCode: log.status_code || log.statusCode || 0,
            statusMessage: log.status_message || log.statusMessage || '',
            durationMs: log.duration_ms || log.durationMs || 0,
            requestHeaders: typeof log.request_headers === 'string'
                ? log.request_headers
                : JSON.stringify(log.request_headers || log.requestHeaders || {}),
            requestBody: log.request_body || log.requestBody || '',
            responseHeaders: typeof log.response_headers === 'string'
                ? log.response_headers
                : JSON.stringify(log.response_headers || log.responseHeaders || {}),
            responseBody: log.response_body || log.responseBody || '',
            error: log.error || '',
            tokenDetected: log.token_detected || log.tokenDetected ? 1 : 0,
            tokenInfo: log.token_info || log.tokenInfo || '',
            rawLog: JSON.stringify(log)
        };

        // 插入数据库
        db.run(`
            INSERT INTO http_logs (
                timestamp, method, url, protocol, status_code, status_message,
                duration_ms, request_headers, request_body, response_headers,
                response_body, error, token_detected, token_info, raw_log
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            logData.timestamp, logData.method, logData.url, logData.protocol,
            logData.statusCode, logData.statusMessage, logData.durationMs,
            logData.requestHeaders, logData.requestBody, logData.responseHeaders,
            logData.responseBody, logData.error, logData.tokenDetected,
            logData.tokenInfo, logData.rawLog
        ]);

        // 获取插入的 ID
        const result = db.exec('SELECT last_insert_rowid() as id');
        const insertedId = result[0]?.values[0]?.[0];

        // 获取完整记录
        const rows = db.exec(`SELECT * FROM http_logs WHERE id = ?`, [insertedId]);
        const insertedLog = rows[0]?.values[0];

        if (insertedLog) {
            const columns = rows[0].columns;
            const logObj = {};
            columns.forEach((col, i) => {
                logObj[col] = insertedLog[i];
            });

            // 广播到所有 WebSocket 客户端
            const message = JSON.stringify({
                type: 'new_log',
                data: formatLogForClient(logObj)
            });

            wsClients.forEach(client => {
                if (client.readyState === 1) {
                    client.send(message);
                }
            });
        }

        console.log(`[${new Date().toISOString()}] Log received: ${logData.method} ${logData.url} - ${logData.statusCode}`);

        res.json({ success: true, id: insertedId });
    } catch (error) {
        console.error('Error saving log:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 获取日志列表
app.get('/api/logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const results = db.exec(`SELECT * FROM http_logs ORDER BY id DESC LIMIT ?`, [limit]);

        if (results.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const columns = results[0].columns;
        const logs = results[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => {
                obj[col] = row[i];
            });
            return formatLogForClient(obj);
        });

        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Error getting logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 获取单条日志
app.get('/api/logs/:id', (req, res) => {
    try {
        const results = db.exec(`SELECT * FROM http_logs WHERE id = ?`, [req.params.id]);

        if (results.length === 0 || results[0].values.length === 0) {
            return res.status(404).json({ success: false, error: 'Log not found' });
        }

        const columns = results[0].columns;
        const row = results[0].values[0];
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });

        res.json({ success: true, data: formatLogForClient(obj) });
    } catch (error) {
        console.error('Error getting log:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 搜索日志
app.get('/api/search', (req, res) => {
    try {
        const query = `%${req.query.q || ''}%`;
        const limit = parseInt(req.query.limit) || 100;

        const results = db.exec(`
            SELECT * FROM http_logs
            WHERE url LIKE ? OR request_body LIKE ? OR response_body LIKE ?
            ORDER BY id DESC LIMIT ?
        `, [query, query, query, limit]);

        if (results.length === 0) {
            return res.json({ success: true, data: [] });
        }

        const columns = results[0].columns;
        const logs = results[0].values.map(row => {
            const obj = {};
            columns.forEach((col, i) => {
                obj[col] = row[i];
            });
            return formatLogForClient(obj);
        });

        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Error searching logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 清空日志
app.delete('/api/logs', (req, res) => {
    try {
        db.run('DELETE FROM http_logs');
        saveDatabase();

        res.json({ success: true });

        // 通知所有客户端
        const message = JSON.stringify({ type: 'logs_cleared' });
        wsClients.forEach(client => {
            if (client.readyState === 1) {
                client.send(message);
            }
        });
    } catch (error) {
        console.error('Error clearing logs:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// API: 统计信息
app.get('/api/stats', (req, res) => {
    try {
        const results = db.exec(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN token_detected = 1 THEN 1 ELSE 0 END) as tokens_detected,
                SUM(CASE WHEN error != '' AND error IS NOT NULL THEN 1 ELSE 0 END) as errors,
                AVG(duration_ms) as avg_duration
            FROM http_logs
        `);

        if (results.length === 0 || results[0].values.length === 0) {
            return res.json({
                success: true,
                data: { total: 0, tokens_detected: 0, errors: 0, avg_duration: 0 }
            });
        }

        const row = results[0].values[0];
        res.json({
            success: true,
            data: {
                total: row[0] || 0,
                tokens_detected: row[1] || 0,
                errors: row[2] || 0,
                avg_duration: row[3] || 0
            }
        });
    } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 检查字符串是否只包含 ASCII 字符
function isAsciiSafe(str) {
    if (typeof str !== 'string') return false;
    for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 127) return false;
    }
    return true;
}

// API: 代理请求 (用于 curl 执行功能)
app.post('/api/proxy', async (req, res) => {
    try {
        const { method, url, headers, body } = req.body;

        if (!url) {
            return res.status(400).json({ success: false, error: 'URL is required' });
        }

        const startTime = Date.now();
        const skippedHeaders = [];

        // 构建请求选项
        const fetchOptions = {
            method: method || 'GET',
            headers: {},
        };

        // 添加 headers
        if (headers && typeof headers === 'object') {
            for (const [key, value] of Object.entries(headers)) {
                // 跳过一些不应该转发的 headers
                const lowerKey = key.toLowerCase();
                if (['host', 'content-length', 'connection'].includes(lowerKey)) continue;

                // 检查 header value 是否包含非 ASCII 字符（已脱敏的敏感数据）
                if (!isAsciiSafe(value)) {
                    console.log(`[PROXY] Skipping header "${key}": contains masked/non-ASCII characters`);
                    skippedHeaders.push(key);
                    continue; // 跳过此 header，不发送
                }

                fetchOptions.headers[key] = value;
            }
        }

        // 添加 body
        if (body && ['POST', 'PUT', 'PATCH'].includes(fetchOptions.method)) {
            fetchOptions.body = body;
        }

        console.log(`[PROXY] ${fetchOptions.method} ${url}`);

        const response = await fetch(url, fetchOptions);
        const duration = Date.now() - startTime;

        // 读取响应
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        let responseBody;
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            try {
                responseBody = await response.json();
                responseBody = JSON.stringify(responseBody, null, 2);
            } catch {
                responseBody = await response.text();
            }
        } else {
            responseBody = await response.text();
        }

        // 限制响应体大小
        if (responseBody.length > 1024 * 1024) {
            responseBody = responseBody.substring(0, 1024 * 1024) + '\n... (truncated)';
        }

        const result = {
            success: true,
            data: {
                statusCode: response.status,
                statusText: response.statusText,
                headers: responseHeaders,
                body: responseBody,
                duration: duration,
            }
        };

        // 如果有跳过的 headers，添加警告信息
        if (skippedHeaders.length > 0) {
            result.skippedHeaders = skippedHeaders;
        }

        res.json(result);
    } catch (error) {
        console.error('[PROXY] Error:', error.message);
        res.json({
            success: false,
            error: error.message,
        });
    }
});

// API: 生成请求 checksum (调用本地 phonepehelper 服务)
app.post('/api/checksum', async (req, res) => {
    try {
        const { path: reqPath, body, uuid } = req.body || {};
        if (!reqPath) {
            return res.status(400).json({ success: false, error: 'path is required' });
        }

        const response = await fetch('http://127.0.0.1:19090/checksum', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: reqPath, body: body || '', uuid: uuid || '' })
        });

        const data = await response.json();
        if (!data || data.ok !== true) {
            return res.status(500).json({ success: false, error: (data && data.error) || 'checksum failed' });
        }

        return res.json({ success: true, data: data.data });
    } catch (error) {
        console.error('[CHECKSUM] Error:', error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// 尝试格式化 JSON 字符串
function tryFormatJson(str) {
    if (!str || typeof str !== 'string' || str.trim() === '') {
        return str;
    }

    const trimmed = str.trim();

    // 检查是否像 JSON（以 { 或 [ 开头）
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
        return str;
    }

    try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        // 不是有效 JSON，返回原始字符串
        return str;
    }
}

// 格式化日志用于前端显示
function formatLogForClient(log) {
    return {
        id: log.id,
        timestamp: log.timestamp,
        receivedAt: log.received_at,
        method: log.method,
        url: log.url,
        protocol: log.protocol,
        statusCode: log.status_code,
        statusMessage: log.status_message,
        durationMs: log.duration_ms,
        requestHeaders: parseHeaders(log.request_headers),
        requestBody: tryFormatJson(log.request_body),
        responseHeaders: parseHeaders(log.response_headers),
        responseBody: tryFormatJson(log.response_body),
        error: log.error,
        tokenDetected: !!log.token_detected,
        tokenInfo: log.token_info,
        rawLog: log.raw_log
    };
}

// 解析 Headers
function parseHeaders(headers) {
    if (!headers) return {};

    if (typeof headers === 'object') return headers;

    try {
        return JSON.parse(headers);
    } catch (e) {
        const result = {};
        const lines = headers.split('\n');
        for (const line of lines) {
            const colonIndex = line.indexOf(':');
            if (colonIndex > 0) {
                const key = line.substring(0, colonIndex).trim();
                const value = line.substring(colonIndex + 1).trim();
                result[key] = value;
            }
        }
        return result;
    }
}

// 创建 HTTP 服务器
const server = http.createServer(app);

// WebSocket 服务器
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    wsClients.add(ws);

    // 发送最近的日志
    try {
        const results = db.exec(`SELECT * FROM http_logs ORDER BY id DESC LIMIT 50`);
        if (results.length > 0) {
            const columns = results[0].columns;
            const logs = results[0].values.map(row => {
                const obj = {};
                columns.forEach((col, i) => {
                    obj[col] = row[i];
                });
                return formatLogForClient(obj);
            });

            ws.send(JSON.stringify({
                type: 'initial_logs',
                data: logs
            }));
        } else {
            ws.send(JSON.stringify({ type: 'initial_logs', data: [] }));
        }
    } catch (error) {
        console.error('Error sending initial logs:', error);
        ws.send(JSON.stringify({ type: 'initial_logs', data: [] }));
    }

    ws.on('close', () => {
        console.log('WebSocket client disconnected');
        wsClients.delete(ws);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        wsClients.delete(ws);
    });
});

// 启动服务器
async function start() {
    await initDatabase();

    server.listen(PORT, () => {
        console.log(`
╔════════════════════════════════════════════════════════╗
║     HTTPS 请求拦截日志服务器                            ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║  Web 界面:    http://localhost:${PORT}                   ║
║  API 端点:    http://localhost:${PORT}/api/log           ║
║  WebSocket:   ws://localhost:${PORT}/ws                  ║
║                                                        ║
║  数据库:      ${DB_PATH}
║                                                        ║
╚════════════════════════════════════════════════════════╝
        `);

        console.log('等待日志...\n');
    });
}

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    saveDatabase();
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});

// 启动
start().catch(error => {
    console.error('启动失败:', error);
    process.exit(1);
});
