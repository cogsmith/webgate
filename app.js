const util = require('util');
const wait = util.promisify(setTimeout);

const path = require('path');
const fs = require('fs');
const dns = require('dns');
const http = require('http');
const https = require('https');
const tls = require('tls');

const _ = require('lodash');
const YAML = require('js-yaml');
const glob = require('glob');
const chalk = require('chalk');
const yargs = require('yargs/yargs');
const axios = require('axios');
const nconf = require('nconf');
const cron = require('node-schedule');
const levelup = require('levelup');
const leveldown = require('leveldown');

const fastify = require('fastify');
const fastify_compress = require('fastify-compress');
const fastify_static = require('fastify-static');

const nodeproxy = require('http-proxy');
const acme = require('acme-client');
const forge = require('node-forge'); forge.options.usePureJavaScript = true;

//

//const XT = require('/DEV/CODE/xtdev/node_modules/@cogsmith/xt').Init();
const XT = require('@cogsmith/xt').Init();
const App = XT.App; const LOG = XT.LOG;

//

App.InitArgs = function () {
    App.Argy = yargs(process.argv).wrap(75).help(false).version(false)
        .usage("\n" + App.Meta.Full + "\n\n" + 'USAGE: node $0 [options]')
        .group('loglevel', 'Log').describe('loglevel', 'Log Level').default('loglevel', 'info')
        .group('logpretty', 'Log').describe('logpretty', 'Log Pretty').boolean('logpretty').default('logpretty', true)
        .describe('ip', 'Bind IP').default('ip', process.env.host || '0.0.0.0')
        .describe('port', 'Backend Bind Port').default('port', process.env.PORT || 89)
        .describe('port80', 'HTTP Bind Port').default('port80', 80)
        .describe('port443', 'HTTPS Bind Port').default('port443', 443)
        .describe('acme', 'ACME Endpoint').default('acme', 'letsencrypt-production')
        .describe('private', 'Private IP').default('private', null)
        .describe('public', 'Public IP').default('public', null).array('public')
        .describe('admin', 'Admin IP').default('admin', null).array('admin')
        .describe('datapath', 'Data Path').default('datapath', '/webgate')
        .group('to', 'Proxy Map').describe('to', 'Map To').default('to', 'INFO').array('to')
        .group('from', 'Proxy Map').describe('from', 'Map From').default('from', null).array('from')
        .group('map', 'Proxy Map').describe('map', 'Map Text').array('map').default('map', null)
        .group('mapfile', 'Proxy Map').describe('mapfile', 'Map File').array('mapfile').default('mapfile', null)
        .demandOption([]);

    let AppArgs = App.Argy.argv;
    App.Args = App.Argy.argv;
    App.Port = AppArgs.port;
    App.IP = AppArgs.ip;
    App.AdminIP = AppArgs.admin;
    App.PublicIP = AppArgs.public;
    App.PrivateIP = AppArgs.private;
    App.DataPath = AppArgs.datapath;
    if (App.Args.map || App.Args.mapfile) { App.Args.to = ['MAP']; }
}


App.InitInfo = function () {
    App.SetInfo('App', function () {
        let info = 'DATA = ' + App.DataPath + ' | ADMIN = ' + (App.AdminIP[0] ? App.AdminIP.join(' ') : 'NONE');
        info += ' | PROXY = ' + App.IP + ' < ' + (App.PrivateIP ? App.PrivateIP : '?') + ' < ' + (App.PublicIP[0] ? App.PublicIP.join(' ') : 'ANY');
        info += (App.Args.from && App.Args.from[0] ? ' : ' + App.Args.from.join(' ') + ' ' : ' : ALL ');
        if (App.Args.to) { info += (App.Args.to && App.Args.to[0] ? '> ' + App.Args.to.join(' ') + ' ' : ''); }
        return info;
    });
}

//

App.GetHostSlug = function (host) { if (!host) { return host; } let slug = host.replace(/\./g, '_').toUpperCase(); let z = slug.split('_'); if (z.length >= 3) { slug = z.slice(-2).join('_') + '_' + z.slice(0, z.length - 2).reverse().join('_'); }; return slug; };
App.GetSlugHost = function (slug) { if (!slug) { return slug; } let host = slug.split('/')[0].replace(/_/g, '.'); let path = slug.split('/').slice(1).join('/') || ''; let z = host.split('.'); if (z.length >= 2) { host = z.slice(2).reverse().join('.') + '.' + z.slice(0, 2).join('.'); }; return host + (path ? '/' + path : ''); }

App.GetDateString = function () { return new Date().toISOString().replace(/-/g, '').substr(0, 8); }

//

//App.StatsRandom = {};

App.CronFXBUSY = false;
App.CronFX = function () {
    if (App.CronFXBUSY) { return setTimeout(App.CronFX, 9); }
    App.CronFXBUSY = true;
    LOG.DEBUG('App.CronFX');
    // Error [OpenError]: IO error: lock /webgate/WEBGATE/DATA/DB/DB20210414/LOCK: already held by process
    let DB = { Stats: App.Stats, RequestLog: App.RequestLog };
    try {
        //for (let i = 0; i < 1000; i++) { let r = Math.random(); App.StatsRandom[r] = i; }
        let dbpath = App.DataPath + '/WEBGATE/DATA/DB/DB' + App.GetDateString();
        fs.mkdirSync(dbpath, { recursive: true });
        let db = levelup(leveldown(dbpath));
        db.put('DB', JSON.stringify(DB), function (err) { if (err) { LOG.ERROR(err); } else { LOG.TRACE('DB.PUT'); } db.close(function () { App.CronFXBUSY = false; }) });
    } catch (ex) { LOG.ERROR(ex); }

    fs.writeFileSync(App.DataPath + '/WEBGATE/DATA/DB/DB' + App.GetDateString() + '.JSON', JSON.stringify(DB) + "\n");

    LOG.DEBUG('App.CronFX:DONE');
}

App.CronMinFX = function () {
    LOG.TRACE('App.CronMinFX');
    App.CronFX();
}

//

App.Init = function () {
    App.CronJob = cron.scheduleJob('*/10 * * * *', App.CronFX);
    App.CronJobMin = cron.scheduleJob('*/1 * * * *', App.CronMinFX);

    App.InitMap();
    App.InitKeys();
    App.InitProxy();
    App.InitServer();
}

//

App.InitDone = function () {
    if (true) {
        if (!App.PublicIP[0] || (App.PublicIP[0] == 'SKIPDNS')) { LOG.WARN('ACME.Warning: With no MAP FROM entries found, and also no PublicIP set, every new host seen will generate certificate requests!!'); }
        else { LOG.WARN('ACME.Warning: With no MAP FROM entries found, any host that resolves to your PublicIP will generate certificate requests: ' + App.PublicIP); }
    }

    if (App.Args.initonly) { App.Exit('App.InitOnly: Exiting Now'); return; } else { setTimeout(App.Main, 9); }
}

//

App.Main = function () {
}

//

App.InitData = function () {
    App.Clients = {};
    App.Server = {};

    App.Requests = 0;
    App.Stats = { Max: { Sockets: { HTTP: 0, HTTPS: 0 } }, Hits: { Host: {}, IP: {}, Total: { ALL: 0, HTTP: 0, HTTPS: 0 } } };

    App.MapWatchers = {};

    App.CertDB = function () { };
    App.CertDB.Data = {};
    App.CertReqs = {};

    App.RequestLog = [];

    App.ACME = { Endpoints: { 'letsencrypt-staging': acme.directory.letsencrypt.staging, 'letsencrypt-production': acme.directory.letsencrypt.production, 'zerossl': 'https://acme.zerossl.com/v2/DV90' } };
    App.ACME.Endpoint = App.ACME.Endpoints[App.Args.acme] ? App.ACME.Endpoints[App.Args.acme] : App.Args.acme;

    if (!fs.existsSync(App.DataPath)) { LOG.WARN('DataPath.CreateMissing: ' + App.DataPath); try { fs.mkdirSync(App.DataPath + '/WWW', { recursive: true }); } catch (ex) { App.Exit(Error('DataPath.CreateFailed: ' + App.DataPath)); } }
    try { fs.writeFileSync(App.DataPath + '/0', '0'); } catch (ex) { App.Exit(Error('DataPath.NoWriteAccess: ' + App.DataPath)); } finally { fs.rmSync(App.DataPath + '/0'); }
    fs.writeFileSync(App.DataPath + '/WWW/favicon.ico', 'AAABAAEAEBAQAAAAAAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAwAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAACAAACAAAAAgIAAgAAAAIAAgACAgAAAwMDAAICAgAAAAP8AAP8AAAD//wD/AAAA/wD/AP//AAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4H///5mf//9gb//+xjf//gYH//126//9P8v//Q8L//0PC//9P8v//Xbr//4GB//+xjf//2Bv//+Zn///4H///', 'base64');
    fs.writeFileSync(App.DataPath + '/WWW/favicon.ico', 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkVykhpFcpvKRXKcikVyk6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApFcpl6RXKf+kVyn/pFcpwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApFcpMaRXKaOkVyn/pFcp/6RXKcOkVykmAAAAAAAAAAAAAAAAAAAAAAAAAACkVyklpFcpsqRXKbCkVyk9pFcpbqRYKj7oyK5Gz5+B5seUc/DkwqlKpFgqR6RXKWykVylppFcp2qRXKbqkVykWpFcpr6RXKf+kVyn/pFcpvObFrUXoyK/E6Miv/924nf/XrZD/6Miv/+jIr7/mxa07pFcp6aRXKf+kVyn/pFcpeaRXKY6kVyn/pFcp/8SNbfnoyK//6Miv/+jIr//dt5z/162R/+jIr//oyK//6Miv/rl8WP2kVyn/pFcp/KRXKUakVykFpFcpcKRXKXvnxq3c6Miv/+jIr//hvaT/vH9d/7h6Vv/euZ7/6Miv/+jIr//mxKy2pFcpg6RXKTYAAAAAAAAAAKRXKSWkVylA6Miv1ejIr//oyK//uXxZ/6RXKv+kVyr/s3FL/+jIr//oyK//6MivsKRXKVSkVykQAAAAAAAAAACkVykhpFcpQ+jIr9PoyK//6Miv/7RzTv+kVyr/pFcq/61pQf/ox67/6Miv/+jIr7CkVylSpFcpFAAAAAAAAAAApFcpMaRXKWDoyK/Q2rOX/8qZev/Wq47/vIBd/7p9Wv/Vqo3/y5p6/9Wqjf/jwqi6pFcplqRXKXKkVykGpFcpRaRXKfmkVyn/tnhS+deukv/oyK//6Miv/+jIr//oyK//6Miv/+jIr//duJ39sGxF9aRXKf+kVyn/pFcphKRXKY6kVyn/pFcp/6RXKdboyK9E6MivyejIr//oyK//6Miv/+jIr/7oyK+16MivL6RXKbOkVyn/pFcp/6RXKZWkVykrpFcp3aRXKfKkVymFpFcpaqZcMBnoyK9S2bGW6diwlODoyK8+pFcpFqRXKWqkVylcpFcpoqRXKZukVykWAAAAAKRXKQGkVykDAAAAAKRXKQSkVylWpFcpnqRXKf+kVyn/pFcpoKRXKVikVykEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKRXKa6kVyn/pFcp/6RXKbIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkVyk3pFcp2KRXKdmkVyk6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/D+cQfw/nEH4H5xBAACcQQAAnEEAAJxBAAGcQYABnEGAAZxBgACcQQAAnEEAAJxBAACcQZAPnEH8P5xB/D+cQQ==', 'base64');
}

App.InitDB = async function () {
    if (App.DB) {
        await App.DB.close();
    }
    App.DB = levelup(leveldown('data/db'));
}

//

App.InitKeys = function () {
    let count = 0;
    let list = glob.sync(App.DataPath + '/*');
    list.forEach((z) => { if (fs.existsSync(z + '/keys/crt')) { count++; LOG.DEBUG('App.InitKey: ' + z); } });
    LOG.INFO('Host.Keys: ' + count + ' Certificates Found');
}

App.InitMap = function () {
    LOG.DEBUG('App.InitMap');

    let map = {};

    // map['/_/gate/*'] = 'BACKEND-ADMIN';
    if (App.PrivateIP) { map[App.PrivateIP] = 'BACKEND-ADMIN'; }

    let mapout = App.ParseMap(map);

    App.Map = mapout;

    App.LoadMaps();
}

App.InitProxy = function () {
    LOG.DEBUG('App.InitProxy');
    App.Proxy = nodeproxy.createProxyServer({});

    App.Proxy.on('open', function (socket) { });
    App.Proxy.on('close', function (socket) { });

    App.Proxy.on('error', function (err, req, res) { LOG.ERROR(err); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('PX:ERROR:HTTP:' + "\n" + err); });

    App.Proxy.on('proxyReq', function (proxyReq, req, res, options) {
        LOG.TRACE({ PREQ: { H: proxyReq.headers, U: proxyReq.url, P: proxyReq.protocol, PP: proxyReq.socket.encrypted }, REQ: { H: req.headers, U: req.url, PP: req.socket.encrypted }, RES: { H: res.headers, P: res.protocol, S: res.statusCode } });
        //proxyReq.removeHeader('X-Forwarded-For'); proxyReq.setHeader('X-Forwarded-For', req.socket.remoteAddress);
        //proxyReq.removeHeader('x-forwarded-for'); proxyReq.setHeader('x-forwarded-for', req.socket.remoteAddress);
    })

    App.Proxy.on('proxyRes', function (proxyRes, req, res, options) {
        LOG.TRACE({ PRES: { H: proxyRes.headers, U: proxyRes.url, P: proxyRes.protocol, S: proxyRes.statusCode }, REQ: { H: req.headers, U: req.url, PP: req.socket.encrypted }, RES: { H: res.headers, P: res.protocol, S: res.statusCode } });
    })
}

App.InitServer = async function () {
    LOG.DEBUG('App.InitServer');

    App.Server.HTTP = http.createServer(App.ServerHander);
    App.Server.HTTP.listen(App.Args.port80, App.IP);

    App.CertLocal = App.GetCert('LOCALHOST') || App.MakeCert('LOCALHOST');
    App.Server.HTTPS = https.createServer({ key: App.CertLocal.KEY, cert: App.CertLocal.CRT, SNICallback: App.SNI }, App.ServerHander);
    App.Server.HTTPS.listen(App.Args.port443, App.IP);
}

//

App.InitBackend = async function (cb) {
    App.BackendAdmin = { Endpoint: 'http://' + App.IP + ':' + '86', Fastify: fastify({ logger: App.Log, disableRequestLogging: true, maxParamLength: 999, ignoreTrailingSlash: false, }) };

    let ffadmin = App.BackendAdmin.Fastify;
    ffadmin.register(fastify_compress);

    ffadmin.addHook('onRequest', (req, rep, nxt) => {
        req.admin = App.AdminIP.includes(req.ip) || false;
        if (!req.admin) { return rep.code(404).send(); }

        let reqip = req.socket.remoteAddress;
        App.Requests++; if (!App.Clients[reqip]) { App.Clients[reqip] = 1; } else { App.Clients[reqip]++; }

        nxt();
    })

    //ffadmin.setNotFoundHandler((req, rep) => { rep.redirect('/404'); });
    ffadmin.setNotFoundHandler((req, rep) => { rep.code(404).send('Z404'); });

    ffadmin.get('/', (req, rep) => { rep.send(App.Meta.Name); });

    ffadmin.get('/zx/px/loglevel', (req, rep) => {
        let level = req.query.level || 'trace';
        rep.send(App.Log.SetLevel(level));
    })

    ffadmin.get('/zx/px/map', (req, rep) => {
        rep.type('text/plain').send(util.inspect(App.Map, { colors: false, depth: null, breakLength: 1 }));
    })

    ffadmin.get('/zx/px/stats', (req, rep) => {
        rep.type('text/plain').send(util.inspect(App.Stats, { colors: false, depth: null, breakLength: 1 }));
    })

    ffadmin.get('/zx/px/acme', (req, rep) => {
        LOG.WARN('PX.Acme'); LOG.DEBUG({ IP: req.socket.remoteAddress, Q: req.query, A: App.AdminIP });
        let acmedomain = 'localhost'; if (req.query.acme) { acmedomain = req.query.acme; }
        rep.send('PX:ACME:' + req.hostname + "\n" + App.GetCert(acmedomain));
    })

    ffadmin.log.infomute = ffadmin.log.info; ffadmin.log.info = ffadmin.log.trace; ffadmin.listen(86, '127.0.0.1', (err, address) => { ffadmin.log.info = ffadmin.log.infomute; if (err) { LOG.ERROR(err); } else { App.BackendAdminStatus = 'UP'; } });

    //

    App.Backend = { Endpoint: 'http://' + App.IP + ':' + App.Port, Fastify: fastify({ logger: App.Log, disableRequestLogging: true, maxParamLength: 999, ignoreTrailingSlash: false, }) };

    let ff = App.Backend.Fastify;
    ff.register(fastify_compress);
    ff.register(fastify_static, { root: App.DataPath + '/WWW', list: false });

    fs.mkdirSync(App.DataPath + '/WWW/.well-known/acme-challenge', { recursive: true });
    fs.writeFileSync(App.DataPath + '/WWW/.well-known/acme-challenge/acme.txt', 'ACME');

    ff.addHook('onRequest', (req, rep, nxt) => {
        req.admin = App.AdminIP.includes(req.ip) || false;

        let reqip = req.socket.remoteAddress;
        App.Requests++; if (!App.Clients[reqip]) { App.Clients[reqip] = 1; } else { App.Clients[reqip]++; }

        nxt();
    })

    //ff.setNotFoundHandler((req, rep) => { rep.redirect('/404'); });
    ff.setNotFoundHandler((req, rep) => { rep.code(404).send('Z404'); });

    ff.get('/', (req, rep) => { rep.send(App.Meta.Name); });

    ff.log.infomute = ff.log.info; ff.log.info = ff.log.trace; ff.listen(89, '127.0.0.1', (err, address) => { ff.log.info = ff.log.infomute; if (err) { LOG.ERROR(err); } else { App.BackendStatus = 'UP'; } });

    // await wait(250);
}

//

App.WatchMaps = function () {
    if (App.Args.mapfile) {
        for (let i = 0; i < App.Args.mapfile.length; i++) {
            let z = App.Args.mapfile[i]; if (!z) { continue; }
            let f = z; if (!z.includes('/')) { f = App.DataPath + '/WEBGATE/MAPS/' + z; }
            if (App.MapWatchers[f]) { App.MapWatchers[f].close(); }
            try { App.MapWatchers = fs.watch(f, (etype, file) => { if (etype == 'change') { if (!App.LoadMapsTimeout) { App.LoadMapsTimeout = setTimeout(App.LoadMaps, 999); } } }); } catch (ex) { LOG.TRACE('App.WatchMap: ' + f + ' = FAIL'); }
        }
    }
}

App.LoadMapsTimeout = false;
App.LoadMaps = function () {
    App.LoadMapsTimeout = false;

    App.WatchMaps();

    let mapmap = {};

    let maptext = '';
    if (App.Args.mapfile) {
        for (let i = 0; i < App.Args.mapfile.length; i++) {
            let z = App.Args.mapfile[i]; if (!z) { continue; }
            let f = z; if (!z.includes('/')) { f = App.DataPath + '/WEBGATE/MAPS/' + z; }
            LOG.DEBUG('App.LoadMapFile: ' + f);
            let txt = ''; try { txt = fs.readFileSync(f).toString().trim(); } catch (ex) { LOG.ERROR('App.LoadMapFile: ' + f + ' = FAIL'); }
            maptext += txt + "\n";
            mapmap = _.merge(mapmap, App.LoadMapText(txt));
        }
    }
    if (App.Args.map) {
        for (let i = 0; i < App.Args.map.length; i++) {
            let z = App.Args.map[i]; if (!z) { continue; }
            maptext += z + "\n";
            mapmap = _.merge(mapmap, App.LoadMapText(maptext));
        }
    }
    maptext = maptext.trim();

    App.Map = App.ParseMap(mapmap);
}

App.LoadMapText = function (yaml) {
    LOG.DEBUG('App.LoadMapText: ' + "\n" + chalk.white(yaml));
    let out = false; try { out = YAML.load(yaml); } catch (ex) { LOG.ERROR(ex); }
    return out;
}

App.LoadMapFile = function (file) {
    LOG.DEBUG('App.LoadMapFile: ' + file);
    let yaml = fs.readFileSync(App.DataPath + '/' + file);
    let out = App.LoadMapText(yaml);
    return out;
}

App.ParseMap = function (map) {
    //if (map['!/*']) { map['ELSE'] = map['!']; delete map['!']; }

    if (!map) { map = {}; }

    if (map['!']) { map['ELSE'] = map['!']; delete map['!']; }
    if (map['*']) { map['ALL'] = map['*']; delete map['*']; }
    //if (map.ALL) { map = { ALL: map.ALL }; }

    let mapcount = 0; let hostcount = 0;
    let mapout = {}; let mapkeys = Object.keys(map);
    for (let i = 0; i < mapkeys.length; i++) {
        let k = mapkeys[i]; let v = map[k];

        if (k.startsWith('/')) { k = '*' + k; }

        let u = k;

        if (k == 'ALL') { mapout['ALL'] = v; mapcount++; LOG.DEBUG('Proxy.Map: ALL => ' + v); }
        else if (k == 'ELSE') { mapout['ELSE'] = v; mapcount++; LOG.DEBUG('Proxy.Map: ELSE => ' + v); }
        else if (k.startsWith('*')) {
            if (!mapout['WILDCARD']) { mapout['WILDCARD'] = {} }
            if (k == '*/*') { mapout['WILDCARD']['*'] = v; } else { mapout['WILDCARD'][k.substr(1)] = v; }
            mapcount++; LOG.DEBUG('Proxy.Map: WILDCARD: ' + k + ' => ' + v);
        }
        else if (k.startsWith('!')) {
            if (!mapout['WILDELSE']) { mapout['WILDELSE'] = {} }
            if (k == '!/*') { mapout['WILDELSE']['*'] = v; } else { mapout['WILDELSE'][k.substr(1)] = v; }
            mapcount++; LOG.DEBUG('Proxy.Map: WILDELSE: ' + k + ' => ' + v);
        }
        else {
            let kk = k; if (!k.includes(':')) { kk = 'http://' + k };
            let u = new URL(kk); let up = u.pathname; let uh = u.host.toUpperCase();
            console.log('K = ' + k); console.log({ U: { HOST: u.host, PATHNAME: u.pathname } });
            if (!mapout[uh]) { mapout[uh] = {}; hostcount++; }
            if (!k.includes('/')) { up = '!'; }
            if (mapout[uh][up]) { LOG.WARN('Proxy.Map: HOST: ' + kk + ' => REDEFINED => ' + v); }
            else { mapcount++; LOG.DEBUG('Proxy.Map: HOST: ' + kk + ' => ' + v); }
            mapout[uh][up] = v;
        }
    }

    LOG.DEBUG('Proxy.Map: ' + hostcount + ' Hosts / ' + mapcount + ' Routes' + "\n" + chalk.white(util.inspect(mapout, { colors: true, depth: null, breakLength: 1 })));
    LOG.INFO('Proxy.Map: ' + hostcount + ' Hosts / ' + mapcount + ' Routes');

    return mapout;
}

//

App.EndRequest = function (req, res, code) {
    if (code = 500) { res.socket.end(); return; }
    res.statusCode = code;
    res.shouldKeepAlive = false;
    res.end();
}

App.ServerHander = function (req, res) {
    let stype = 'HTTP'; if (req.socket.encrypted) { stype = 'HTTPS'; } let stypelc = stype.toLowerCase();

    req.host = req.headers.host || 'NOHOST'; req.hostuc = req.host.toUpperCase();
    req.ip = req.socket.remoteAddress;
    req.admin = App.AdminIP.includes(req.ip) || false;
    req.urlz = false; try { req.urlz = new URL(stypelc + '://' + req.host + req.url); } catch (ex) { }

    delete req.headers['X-Forwarded-For']; req.headers['x-forwarded-for'] = req.ip;
    delete req.headers['X-Forwarded-Host']; req.headers['x-forwarded-host'] = req.host;
    delete req.headers['X-Forwarded-Proto']; req.headers['x-forwarded-proto'] = stypelc;

    App.Stats.Hits.Total.ALL++;
    App.Stats.Hits.Total[stype]++;
    if (!App.Stats.Hits.Host[req.hostuc]) { App.Stats.Hits.Host[req.hostuc] = 1 } else { App.Stats.Hits.Host[req.hostuc]++ }
    if (!App.Stats.Hits.IP[req.ip]) { App.Stats.Hits.IP[req.ip] = 1 } else { App.Stats.Hits.IP[req.ip]++ }
    if (App.Server[stype]._connections > App.Stats.Max.Sockets[stype]) { App.Stats.Max.Sockets[stype] = App.Server[stype]._connections }

    LOG.TRACE({ REQ: { HOST: req.host, URL: req.url } });

    if (req.url.startsWith('http://') || req.url.startsWith('https://')) { req.forproxy = true; if (req.urlz) { req.url = req.urlz.pathname; } }

    let url = stypelc + '://' + req.host + req.url;

    LOG.TRACE(chalk.white(req.ip) + ' ' + req.method + ' ' + url, { Admin: req.admin, Open: { HTTP: App.Server.HTTP._connections, HTTPS: App.Server.HTTPS._connections } });
    LOG.TRACE(chalk.white(req.ip) + ' ' + req.method + ' ' + url, { Admin: req.admin, Method: req.method, URL: url, Headers: req.headers });

    let map = App.Map; // map = {};

    let t = false;
    let ttype = null;

    let u = false;
    let uhost = false;
    try { u = new URL(url); } catch (ex) { ttype = 'INVALID'; t = url; LOG.WARN('ServerHandler: URL_INVALID = ' + url); LOG.WARN(ex); }
    try { uhost = u.host.toUpperCase(); } catch (ex) { }

    // #1

    if (map.ALL) { ttype = 'ALL'; t = 'ALL'; }

    if (!t && map.WILDCARD) {
        if (!t) { t = map.WILDCARD[u.pathname]; }
        if (!t) { let kz = Object.keys(map.WILDCARD); for (let i = 0; i < kz.length; i++) { let k = kz[i]; let ku = k.substr(0, k.length - 1); let ku2 = k.substr(0, k.length - 2); if ((k.substr(-2) == '/*' && u.pathname == ku2) || (k.substr(-1) == '*' && u.pathname.startsWith(ku))) { t = map.WILDCARD[k]; } } }
        if (t) { ttype = 'WILDCARD'; }
    }

    if (!t && map[uhost]) {
        if (!t) { t = map[uhost]['*']; }
        if (!t) { t = map[uhost][u.pathname]; }
        if (!t) { let kz = Object.keys(map[uhost]); for (let i = 0; i < kz.length; i++) { let k = kz[i]; let ku = k.substr(0, k.length - 1); let ku2 = k.substr(0, k.length - 2); if ((k.substr(-2) == '/*' && u.pathname == ku2) || (k.substr(-1) == '*' && u.pathname.startsWith(ku))) { t = map[uhost][k]; } } }
        if (!t) { t = map[uhost]['!']; }
        if (t) { ttype = 'HOST'; }
    }

    if (!t && map.WILDELSE) {
        if (!t) { t = map.WILDELSE['*']; }
        if (!t) { t = map.WILDELSE[u.pathname]; }
        if (!t) { let kz = Object.keys(map.WILDELSE); for (let i = 0; i < kz.length; i++) { let k = kz[i]; let ku = k.substr(0, k.length - 1); let ku2 = k.substr(0, k.length - 2); if ((k.substr(-2) == '/*' && u.pathname == ku2) || (k.substr(-1) == '*' && u.pathname.startsWith(ku))) { t = map.WILDELSE[k]; } } }
        if (t) { ttype = 'WILDELSE'; }
    }

    // if (t != 'ALL') { if (map.ELSE) { ttype = 'ELSE'; t = 'ELSE'; } else { ttype = 'NOMAP'; t = 'NOMAP'; } }

    if (!t) { ttype = 'NOMAP'; t = 'NOMAP'; }

    if (req.hostuc.startsWith('WWW.')) { ttype = 'WWW-301'; t = new URL(stypelc + '://' + req.host.substr(4) + req.url).href; }

    let tfull = t;

    if (!req.ip) { t = 'ERROR'; }

    if (typeof t == 'string' && t.includes(' || ')) { t = App.Balancer.Get(t); }

    if (!req.admin && t == 'BACKEND-ADMIN') { t = 'DENY:' + t; }
    if (req.forproxy && t != 'PROXY') { t = 'DENY:' + t; }

    let logto = (ttype ? ttype + ' => ' : ''); if (t != tfull) { logto += tfull + ' => '; }; logto += t;
    if (Number.isInteger(t)) { try { logto = t + ' => ' + http.STATUS_CODES[t].toUpperCase(); } catch (ex) { logto = t + ' => 500 => ' + http.STATUS_CODES[500].toUpperCase(); t = 500; } };
    if (t == 'ALL') { logto = 'ALL' + ' => ' + map.ALL } else if (t == 'ELSE') { logto = 'ELSE' + ' => ' + map.ELSE };
    let logmsg = (chalk[req.admin ? 'yellow' : 'white'](req.ip) + ' ' + (req.forproxy ? 'PROXY ' : '') + req.method + ' ' + u.href + ' => ' + logto + ((LOG.level == 'trace') ? "\n" : '')).replaceAll(' => ', chalk.white(' => ')).replaceAll('DENY:', chalk.red('DENY:'));
    let loglinelevel = 'INFO'; if (t == 'BADURL') { loglinelevel = 'TRACE'; };
    LOG[loglinelevel](logmsg);

    let logrow = {
        DT: new Date(),
        Num: App.Stats.Hits.Total.ALL,
        Admin: req.admin,
        Via: stype,
        IP: req.ip,
        URL: req.url,
        Host: req.host,
        Method: req.method,
        Target: t,
        TargetType: ttype,
        UserAgent: req.headers['user-agent']
    };
    if (t != tfull) { logrow.TargetFull = tfull; }

    console.log(logrow);
    App.RequestLog.push(logrow);

    if (t == 'ALL') { t = map.ALL; }
    if (t == 'ELSE') { t = map.ELSE; }

    if (typeof t == 'string' && !isNaN(t)) { t = Number.parseInt(t); }

    if (typeof (t) == 'number') { res.statusCode = t; res.end(); }
    else if (t == 'HANGUP' || t == 'INVALID') { res.statusCode = 502; res.shouldKeepAlive = false; res.socket.end(); res.end(); return; }
    else if (t == 'BADURL' || t == 'DENY' || t.startsWith('DENY:')) { res.statusCode = 404; res.end(); return; }
    else if (t == '404' || t == 'NOMAP' || t == 'NOTFOUND') { res.statusCode = 404; res.end(t + "\n"); }
    else if (ttype == 'WWW-301') { res.writeHead(301, { Location: t }); res.end(t + "\n"); }
    else if (t == 'ERROR') { res.statusCode = 500; res.end('ERROR' + "\n"); }
    else if (t == 'OK') { res.statusCode = 200; res.end('OK' + "\n"); }
    else if (t == 'TEAPOT') { res.statusCode = 418; res.end('TEAPOT' + "\n"); }
    else if (t == 'PROXY') { App.Proxy.web(req, res, { target: u.href }); }
    else if (t == 'BACKEND') { App.Proxy.web(req, res, { target: App.Backend.Endpoint }); }
    else if (t == 'BACKEND-ADMIN') { if (req.admin) { App.Proxy.web(req, res, { target: App.BackendAdmin.Endpoint }); } else { res.statusCode = 404; res.end(); } }
    else if (t == 'ACME') { App.Proxy.web(req, res, { target: App.Backend.Endpoint }); }
    else if (t == 'WEBFILES') { App.Proxy.web(req, res, { target: App.Backend.Endpoint }); }
    else if (t == 'INFO') { try { res.end(req.method + ' ' + stype.toLowerCase() + '://' + req.host + '' + req.url + "\n" + (new Date().toISOString()) + "\n" + req.headers['user-agent'] + "\n" + req.ip + "\n"); } catch (ex) { LOG.ERROR(ex); } }
    else if (t && t.startsWith('>')) {
        t = t.substring(1);
        if (!t.includes(':')) { t = 'http://' + t };
        let zurl = new URL(t);
        let loc = zurl.href + u.search;
        res.writeHead(302, { Location: loc });
        res.end(loc + "\n");
    }
    else if (t && t.startsWith('|')) {
        t = t.substring(1);
        if (!t.includes(':')) { t = 'http://' + t };

        let html = '';
        html += "<html><head><style>html,body,iframe { border:0px;margin:0px;padding:0px;width:100%;height:100% }</style></head><body><iframe src='" + t + "'></iframe></body></html>"

        res.end(html + "\n");
    }
    else if (t && t.startsWith('^')) {
        t = t.substring(1);
        if (!t.includes(':')) { t = 'http://' + t };
        let tp = '/'; tp = new URL(t).pathname;
        req.url = (req.url + (tp.pathname || '')) || '/';
        try { App.Proxy.web(req, res, { target: t, followRedirects: false, changeOrigin: true }); } catch (ex) { LOG.ERROR(ex); }
    }
    else if (t && (t.startsWith('@') || t.startsWith('~'))) {
        if (t.startsWith('~')) {
            delete req.headers['x-forwarded-for'];
            delete req.headers['x-forwarded-host'];
            delete req.headers['x-forwarded-proto'];
        }
        t = t.substring(1);
        if (!t.includes(':')) { t = 'http://' + t };
        let tp = '/'; tp = new URL(t).pathname;
        req.url = (req.url + (tp.pathname || '')) || '/';
        try { App.Proxy.web(req, res, { target: t, followRedirects: true, changeOrigin: true }); } catch (ex) { LOG.ERROR(ex); }
    }
    else {
        if (!t || t.toUpperCase() == 'NULL') { res.statusCode = 500; res.end('NULL' + "\n"); return; }
        if (!t.includes(':')) { t = 'http://' + t };
        let tp = '/'; tp = new URL(t).pathname;
        req.url = tp.pathname || '/';
        try { App.Proxy.web(req, res, { target: t, followRedirects: false, changeOrigin: true }); } catch (ex) { LOG.ERROR(ex); }
    }
}

//

App.SNI = function (host, cb) {
    host = host.toUpperCase();
    LOG.TRACE('SNI: ' + host);
    if (App.PublicIP.includes(host) || (host == 'LOCALHOST') || (host == App.PrivateIP) || (host == App.IP)) { cb(null, App.GetCert('LOCALHOST').Context); return; }

    // if (host.includes('COGSMITH.COM')) { } else { return; }

    let cert = App.GetCert(host);
    if (cert) { cb(null, cert.Context); return; }
    else if (!App.Map[host] && (!host.startsWith('WWW.') || (host.startsWith('WWW.') && !App.Map[host.substr(4)]))) { LOG.DEBUG('SNI.Deny: ' + host + ' Not Listed In Routing Map'); cb(null, Error('SNI:NOMAP')); return; }
    else {
        if (!App.PublicIP[0] || (App.PublicIP[0] == 'SKIPDNS')) {
            LOG.DEBUG('SNI: Skipping DNS Verify Because PublicIP = ' + App.PublicIP[0]);
            App.RequestCert(host, cb);
        }
        else {
            let dnsdo = 'lookup'; // let dnsdo = 'resolve';
            dns[dnsdo](host, (err, addrlist) => {
                if (err) { LOG.WARN(err); cb(Error('SNI:DNSERR')); return; }
                if (addrlist) { if (!Array.isArray(addrlist)) { addrlist = [addrlist]; }; LOG.TRACE({ msg: 'SNI.DNS', PublicIP: App.PublicIP, Host: host, List: addrlist }); }
                try {
                    let match = false; for (let i = 0; i < App.PublicIP.length; i++) { if (addrlist.includes(App.PublicIP[i])) { match = true; } }
                    if (match) { App.RequestCert(host, cb); }
                    else { LOG.WARN('SNI.Deny: ' + host + ' Not In PublicIP: ' + addrlist.join(' ') + ' => ' + App.PublicIP.join(' ')); cb(Error('SNI:NXHOST')); return; }
                } catch (ex) { LOG.ERROR(ex); cb(ex); return; }
            });
        }
    }
}

//

App.GetCert = function (domain) {
    domain = domain.toUpperCase();
    LOG.TRACE('GetCert: ' + domain);
    if (domain == 'GATE.TEST') { domain = 'LOCALHOST'; }
    if (App.CertDB.Data[domain]) {
        let cert = App.CertDB.Data[domain];
        if (Date.now() > cert.Expiration) {
            LOG.TRACE('GetCert.Expired: ' + domain + ' @ ' + new Date(cert.Expiration));
            return false;
        }
        else {
            LOG.TRACE('GetCert.Cached: ' + domain);
            return cert;
        }
    }
    else {
        let slug = App.GetHostSlug(domain);
        if (!fs.existsSync(App.DataPath + '/' + slug + '/keys/key') || !fs.existsSync(App.DataPath + '/' + slug + '/keys/crt')) { LOG.DEBUG('GetCert.Missing: ' + domain); return false; }
        LOG.INFO('GetCert.LoadFile: ' + domain);
        let expiration = Date.now() - 86400000; try { expiration = fs.statSync(App.DataPath + '/' + slug + '/keys/crt').birthtimeMs + (60 * 86400000); } catch (ex) { }
        if (Date.now() > expiration) { LOG.TRACE('GetCert.Expired: ' + domain + ' @ ' + new Date(expiration)); return false; }
        LOG.DEBUG('GetCert.ExpirationDate: ' + domain + ' = ' + new Date(expiration));
        let key = undefined; try { key = fs.readFileSync(App.DataPath + '/' + slug + '/keys/key'); } catch (ex) { }
        let crt = undefined; try { crt = fs.readFileSync(App.DataPath + '/' + slug + '/keys/crt'); } catch (ex) { }
        let csr = undefined; try { csr = fs.readFileSync(App.DataPath + '/' + slug + '/keys/csr'); } catch (ex) { }
        let context = tls.createSecureContext({ key: key, cert: crt });
        return App.CertDB.Data[domain] = { Domain: domain, Context: context, KEY: key, CRT: crt, CSR: csr, Expiration: expiration };
    }
}

App.WriteCert = function (slug, cert) {
    LOG.TRACE('WriteCert: ' + slug);
    fs.mkdirSync(App.DataPath + '/' + slug + '/keys', { recursive: true });
    if (cert.KEY) {
        try { fs.rmSync(App.DataPath + '/' + slug + '/keys/key'); } catch (ex) { LOG.ERROR(ex); }
        try { fs.writeFileSync(App.DataPath + '/' + slug + '/keys/key', cert.KEY); } catch (ex) { LOG.ERROR(ex); }
    }
    if (cert.CRT) {
        try { fs.rmSync(App.DataPath + '/' + slug + '/keys/crt'); } catch (ex) { LOG.ERROR(ex); }
        try { fs.writeFileSync(App.DataPath + '/' + slug + '/keys/crt', cert.CRT); } catch (ex) { LOG.ERROR(ex); }
    }
    if (cert.CSR) {
        try { fs.rmSync(App.DataPath + '/' + slug + '/keys/csr'); } catch (ex) { LOG.ERROR(ex); }
        try { fs.writeFileSync(App.DataPath + '/' + slug + '/keys/csr', cert.CSR); } catch (ex) { LOG.ERROR(ex); }
    }
}

App.MakeCert = function (domain) {
    domain = domain.toUpperCase();
    let slug = App.GetHostSlug(domain);
    LOG.WARN('MakeCert: ' + domain);

    var attrs = [{ name: 'commonName', value: domain }];
    let pki = forge.pki; let keys = pki.rsa.generateKeyPair(2048); let cert = pki.createCertificate();
    cert.publicKey = keys.publicKey; cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date('2099-12-31T23:59:59'); // cert.validity.notAfter = new Date(); cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear()+10);
    cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey);
    let key = forge.pki.privateKeyToPem(keys.privateKey);
    var crt = pki.certificateToPem(cert);

    App.WriteCert(slug, { KEY: key, CRT: crt });
    return App.GetCert(domain);
}

App.RequestCert = function (domain, cb) {
    if (!cb) { cb = function () { } }
    domain = domain.toUpperCase(); let slug = App.GetHostSlug(domain);
    //console.log(App.CertReqs);
    if (App.CertReqs[domain]) {
        if (Date.now() > (App.CertReqs[domain].DT + (1000 * 60 * 15))) {
            LOG.INFO('RequestCert.Timeout: ' + domain);
            App.CertReqs[domain] = false;
            delete App.CertReqs[domain];
        }
        else {
            LOG.TRACE('RequestCert.AlreadySent: ' + domain);
            cb(null, Error('SNI:BUSY'));
            return;
        }
    }
    App.CertReqs[domain] = { DT: Date.now() };

    let acmeCreate = async function (authz, challenge, key) { fs.writeFileSync(App.DataPath + '/' + '/WWW/.well-known/acme-challenge/' + challenge.token, key); }
    let acmeRemove = async function (authz, challenge, key) { fs.rmSync(App.DataPath + '/' + '/WWW/.well-known/acme-challenge/' + challenge.token); }

    var afx = async function () {
        if (slug == 'LOCALHOST') { cb(null, App.GetCert(domain).Context); return; }
        LOG.WARN('RequestCert: ' + domain);

        let akey = ''; if (fs.existsSync(App.DataPath + '/' + 'ACME/keys/key')) { akey = fs.readFileSync(App.DataPath + '/' + 'ACME/keys/key'); }
        else {
            LOG.INFO('RequestCert.CreateAccount: ' + App.DataPath + '/ACME');
            akey = await acme.forge.createPrivateKey();
            fs.mkdirSync(App.DataPath + '/' + 'ACME/keys', { recursive: true }); fs.writeFileSync(App.DataPath + '/' + 'ACME/keys/key', akey + '');
        }

        const [key, csr] = await acme.forge.createCsr({ commonName: domain });
        App.WriteCert(slug, { CSR: csr, KEY: key });

        const client = new acme.Client({ accountKey: akey, directoryUrl: App.ACME.Endpoint });
        let crt = false; try { crt = await client.auto({ csr: csr, challengeCreateFn: acmeCreate, challengeRemoveFn: acmeRemove, termsOfServiceAgreed: true, email: 'contact@' + domain }); }
        catch (ex) { LOG.WARN({ msg: 'RequestCert.Failed: ' + domain + ' = ACME: ' + ex.message }); cb(null, Error('SNI:ACMEFAIL')); return; }
        if (crt) { LOG.INFO('RequestCert.Success: ' + domain); App.WriteCert(slug, { CRT: crt }); cb(null, App.GetCert(domain).Context); return; }
    }
    try { afx(); } catch (ex) { LOG.ERROR(ex); }
}

//

App.Balancer = {
    DB: {},

    Mode: 'ROUNDROBIN',
    Mode: 'RANDOM',

    Add: function (tag) {
        this.DB[tag] = { Tag: tag, List: tag.split(' || '), Next: 0 };
    },

    Get: function (tag) {
        if (!this.DB[tag]) { this.Add(tag); }
        let z = this.DB[tag];

        if (this.Mode == 'LEASTBUSY') { this.Mode = 'RANDOM'; }

        let out = tag;
        if (this.Mode == 'RANDOM') {
            out = z.List[Math.floor(Math.random() * z.List.length)];
        }
        else if (this.Mode == 'ROUNDROBIN') {
            out = z.List[z.Next++];
            if (z.Next > z.List.length - 1) { z.Next = 0; }
        } else if (this.Modes == 'LEASTBUSY') {
            // TODO
        }

        return out;
    }
}

//

App.Run();
