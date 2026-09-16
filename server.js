const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8066);
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'global-config.json');
const ACCOUNTS_FILE = path.join(ROOT, 'accounts.json');
const DEFAULT_PASSWORD = 'ma123456';
const DEFAULT_CONFIG = {
    soundEnabled: true,
    configT: 20,
    configJ: 10,
    multiplierProbabilities: [42, 28.8, 12.7, 10.8, 5.7],
    password: DEFAULT_PASSWORD
};
const USERNAME_PATTERN = /^[\u4e00-\u9fffA-Za-z0-9_-]{1,20}$/;
const MAX_ACCOUNT_VALUE = 999999999;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
};

function isValidPassword(password) {
    return typeof password === 'string' && password.length > 0 && password.length <= 64;
}

function isValidConfig(config) {
    if (!config || typeof config.soundEnabled !== 'boolean' ||
        !Number.isInteger(config.configT) || config.configT <= 0 ||
        !Number.isInteger(config.configJ) || config.configJ <= 0 ||
        !Array.isArray(config.multiplierProbabilities) || config.multiplierProbabilities.length !== 5) {
        return false;
    }
    if (config.password !== undefined && !isValidPassword(config.password)) {
        return false;
    }
    const probabilities = config.multiplierProbabilities.map(Number);
    const total = probabilities.reduce((sum, value) => sum + value, 0);
    return probabilities.every(value => Number.isFinite(value) && value >= 0) && Math.abs(total - 100) <= 0.01;
}

function normalizeConfig(config, fallbackPassword = DEFAULT_PASSWORD) {
    if (!isValidConfig(config)) return { ...DEFAULT_CONFIG };
    return {
        soundEnabled: config.soundEnabled,
        configT: config.configT,
        configJ: config.configJ,
        multiplierProbabilities: config.multiplierProbabilities.map(Number),
        password: isValidPassword(config.password) ? config.password : fallbackPassword
    };
}

function writeJsonAtomic(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, filePath);
}

function readConfig() {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return normalizeConfig(config);
    } catch (error) {
        return { ...DEFAULT_CONFIG };
    }
}

function isValidUsername(username) {
    return typeof username === 'string' && USERNAME_PATTERN.test(username);
}

function isNonNegativeInt(value) {
    return Number.isInteger(value) && value >= 0 && value <= MAX_ACCOUNT_VALUE;
}

function clampAccountValue(value) {
    return Math.max(0, Math.min(MAX_ACCOUNT_VALUE, value));
}

function createAccount(username) {
    return {
        username,
        totalBeads: 0,
        totalScore: 0,
        updatedAt: Date.now()
    };
}

function publicAccount(account) {
    return {
        username: account.username,
        totalBeads: account.totalBeads,
        totalScore: account.totalScore,
        updatedAt: account.updatedAt
    };
}

function isValidAccountRecord(account, username) {
    return account &&
        account.username === username &&
        isNonNegativeInt(account.totalBeads) &&
        isNonNegativeInt(account.totalScore) &&
        Number.isFinite(account.updatedAt);
}

function readAccounts() {
    try {
        const parsed = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
        const accounts = {};
        for (const [username, account] of Object.entries(parsed)) {
            if (!isValidUsername(username) || !isValidAccountRecord(account, username)) continue;
            accounts[username] = {
                username,
                totalBeads: account.totalBeads,
                totalScore: account.totalScore,
                updatedAt: account.updatedAt
            };
        }
        return accounts;
    } catch (error) {
        if (error && error.code === 'ENOENT') return {};
        return {};
    }
}

function writeAccounts(accounts) {
    writeJsonAtomic(ACCOUNTS_FILE, accounts);
}

let accountWriteQueue = Promise.resolve();

function withAccountsLock(fn) {
    const run = accountWriteQueue.then(fn, fn);
    accountWriteQueue = run.then(() => undefined, () => undefined);
    return run;
}

function sendJson(response, status, value) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(value));
}

function readJsonBody(request, maxBytes = 16 * 1024) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.on('data', chunk => {
            body += chunk;
            if (body.length > maxBytes) {
                request.destroy();
                reject(new Error('too-large'));
            }
        });
        request.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch (error) {
                reject(new Error('invalid-json'));
            }
        });
        request.on('error', reject);
    });
}

function handleConfigUpdate(request, response) {
    readJsonBody(request).then((incoming) => {
        if (!isValidConfig(incoming)) {
            sendJson(response, 400, { error: 'Invalid global config' });
            return;
        }
        const current = readConfig();
        const config = normalizeConfig(incoming, current.password);
        writeJsonAtomic(CONFIG_FILE, config);
        sendJson(response, 200, config);
    }).catch((error) => {
        const status = error && error.message === 'too-large' ? 413 : 400;
        sendJson(response, status, { error: error && error.message === 'too-large' ? 'Payload too large' : 'Invalid JSON' });
    });
}

function applyAccountUpdate(account, incoming) {
    let nextBeads = account.totalBeads;
    let nextScore = account.totalScore;
    let changed = false;

    if (incoming.totalBeads !== undefined) {
        if (!isNonNegativeInt(incoming.totalBeads)) return { error: '弹珠数量必须是 0 到 999999999 的整数' };
        nextBeads = incoming.totalBeads;
        changed = true;
    }
    if (incoming.totalScore !== undefined) {
        if (!isNonNegativeInt(incoming.totalScore)) return { error: '积分数量必须是 0 到 999999999 的整数' };
        nextScore = incoming.totalScore;
        changed = true;
    }
    if (incoming.addBeads !== undefined) {
        if (!Number.isInteger(incoming.addBeads) || Math.abs(incoming.addBeads) > MAX_ACCOUNT_VALUE) {
            return { error: '弹珠增减数量无效' };
        }
        nextBeads = clampAccountValue(nextBeads + incoming.addBeads);
        changed = true;
    }
    if (incoming.addScore !== undefined) {
        if (!Number.isInteger(incoming.addScore) || Math.abs(incoming.addScore) > MAX_ACCOUNT_VALUE) {
            return { error: '积分增减数量无效' };
        }
        nextScore = clampAccountValue(nextScore + incoming.addScore);
        changed = true;
    }

    if (!changed) return { error: '没有可更新的账户数据' };

    account.totalBeads = nextBeads;
    account.totalScore = nextScore;
    account.updatedAt = Date.now();
    return { account };
}

function handleAccountLogin(request, response) {
    readJsonBody(request).then((incoming) => {
        const username = typeof incoming.username === 'string' ? incoming.username.trim() : '';
        if (!isValidUsername(username)) {
            sendJson(response, 400, { error: '用户名需为 1~20 个中文、字母、数字、下划线或短横线' });
            return;
        }
        return withAccountsLock(() => {
            const accounts = readAccounts();
            const created = !accounts[username];
            if (created) accounts[username] = createAccount(username);
            writeAccounts(accounts);
            sendJson(response, 200, { ...publicAccount(accounts[username]), created });
        });
    }).catch((error) => {
        const status = error && error.message === 'too-large' ? 413 : 400;
        sendJson(response, status, { error: 'Invalid JSON' });
    });
}

function handleAccountRead(response, username) {
    if (!isValidUsername(username)) {
        sendJson(response, 400, { error: '用户名不合法' });
        return;
    }
    const accounts = readAccounts();
    if (!accounts[username]) {
        sendJson(response, 404, { error: '账户不存在' });
        return;
    }
    sendJson(response, 200, publicAccount(accounts[username]));
}

function handleAccountUpdate(request, response, username, { createIfMissing = false } = {}) {
    if (!isValidUsername(username)) {
        sendJson(response, 400, { error: '用户名不合法' });
        readJsonBody(request).catch(() => {});
        return;
    }
    readJsonBody(request).then((incoming) => {
        return withAccountsLock(() => {
            const accounts = readAccounts();
            if (!accounts[username]) {
                if (!createIfMissing) {
                    sendJson(response, 404, { error: '账户不存在' });
                    return;
                }
                accounts[username] = createAccount(username);
            }
            const result = applyAccountUpdate(accounts[username], incoming);
            if (result.error) {
                sendJson(response, 400, { error: result.error });
                return;
            }
            writeAccounts(accounts);
            sendJson(response, 200, publicAccount(accounts[username]));
        });
    }).catch(() => {
        sendJson(response, 400, { error: 'Invalid JSON' });
    });
}

function handleAdminAccountUpdate(request, response) {
    readJsonBody(request).then((incoming) => {
        const username = typeof incoming.username === 'string' ? incoming.username.trim() : '';
        if (!isValidUsername(username)) {
            sendJson(response, 400, { error: '用户名需为 1~20 个中文、字母、数字、下划线或短横线' });
            return;
        }
        const currentConfig = readConfig();
        if (incoming.password !== currentConfig.password) {
            sendJson(response, 403, { error: '管理密码错误' });
            return;
        }
        return withAccountsLock(() => {
            const accounts = readAccounts();
            if (!accounts[username]) accounts[username] = createAccount(username);
            const result = applyAccountUpdate(accounts[username], incoming);
            if (result.error) {
                sendJson(response, 400, { error: result.error });
                return;
            }
            writeAccounts(accounts);
            sendJson(response, 200, publicAccount(accounts[username]));
        });
    }).catch(() => {
        sendJson(response, 400, { error: 'Invalid JSON' });
    });
}

function parsePathname(request) {
    try {
        return new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    } catch (error) {
        return request.url.split('?')[0];
    }
}

function serveFile(request, response, pathname) {
    const requestedPath = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.resolve(ROOT, `.${requestedPath}`);
    if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
    }
    fs.readFile(filePath, (error, data) => {
        if (error) {
            response.writeHead(error.code === 'ENOENT' ? 404 : 500);
            response.end(error.code === 'ENOENT' ? 'Not found' : 'Server error');
            return;
        }
        response.writeHead(200, {
            'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        });
        response.end(data);
    });
}

const server = http.createServer((request, response) => {
    const pathname = parsePathname(request);

    if (pathname === '/api/config' && request.method === 'GET') {
        sendJson(response, 200, readConfig());
        return;
    }
    if (pathname === '/api/config' && request.method === 'PUT') {
        handleConfigUpdate(request, response);
        return;
    }
    if (pathname === '/api/accounts/login' && request.method === 'POST') {
        handleAccountLogin(request, response);
        return;
    }
    if (pathname === '/api/accounts/admin' && request.method === 'POST') {
        handleAdminAccountUpdate(request, response);
        return;
    }

    const accountPrefix = '/api/accounts/';
    if (pathname.startsWith(accountPrefix)) {
        let username = pathname.slice(accountPrefix.length);
        try {
            username = decodeURIComponent(username);
        } catch (error) {
            sendJson(response, 400, { error: '用户名不合法' });
            return;
        }
        if (request.method === 'GET') {
            handleAccountRead(response, username);
            return;
        }
        if (request.method === 'PUT') {
            handleAccountUpdate(request, response, username, { createIfMissing: true });
            return;
        }
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD, PUT, POST' });
        response.end('Method not allowed');
        return;
    }
    serveFile(request, response, pathname);
});

server.listen(PORT, HOST, () => {
    console.log(`Happy Pinball server: http://localhost:${PORT}`);
    console.log(`Other machines: http://<this-computer-LAN-IP>:${PORT}`);
});
