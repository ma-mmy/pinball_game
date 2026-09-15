const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8066);
const ROOT = __dirname;
const CONFIG_FILE = path.join(ROOT, 'global-config.json');
const DEFAULT_PASSWORD = 'ma123456';
const DEFAULT_CONFIG = {
    soundEnabled: true,
    configT: 20,
    configJ: 10,
    multiplierProbabilities: [42, 28.8, 12.7, 10.8, 5.7],
    password: DEFAULT_PASSWORD
};

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

function readConfig() {
    try {
        const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return normalizeConfig(config);
    } catch (error) {
        return { ...DEFAULT_CONFIG };
    }
}

function sendJson(response, status, value) {
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
    });
    response.end(JSON.stringify(value));
}

function handleConfigUpdate(request, response) {
    let body = '';
    request.on('data', chunk => {
        body += chunk;
        if (body.length > 16 * 1024) request.destroy();
    });
    request.on('end', () => {
        try {
            const incoming = JSON.parse(body);
            if (!isValidConfig(incoming)) {
                sendJson(response, 400, { error: 'Invalid global config' });
                return;
            }
            const current = readConfig();
            const config = normalizeConfig(incoming, current.password);
            fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
            sendJson(response, 200, config);
        } catch (error) {
            sendJson(response, 400, { error: 'Invalid JSON' });
        }
    });
}

function serveFile(request, response) {
    const pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
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
    if (request.url === '/api/config' && request.method === 'GET') {
        sendJson(response, 200, readConfig());
        return;
    }
    if (request.url === '/api/config' && request.method === 'PUT') {
        handleConfigUpdate(request, response);
        return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.writeHead(405, { Allow: 'GET, HEAD, PUT' });
        response.end('Method not allowed');
        return;
    }
    serveFile(request, response);
});

server.listen(PORT, HOST, () => {
    console.log(`Happy Pinball server: http://localhost:${PORT}`);
    console.log(`Other machines: http://<this-computer-LAN-IP>:${PORT}`);
});
