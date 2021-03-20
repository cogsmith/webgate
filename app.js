// process.on('uncaughtException', function (err) { console.log("\n"); console.log(err); console.log("\n"); process.exit(1); }); // throw(Error('ERROR'));

//

const util = require('util');
const path = require('path');
const fs = require('fs');
const dns = require('dns');
const http = require('http');
const https = require('https');
const tls = require('tls');

const _ = require('lodash');
const chalk = require('chalk');
const pino = require('pino');
const yargs = require('yargs/yargs');
const axios = require('axios');
const nconf = require('nconf');

const fastify = require('fastify');
const fastify_compress = require('fastify-compress');
const fastify_static = require('fastify-static');

const nodeproxy = require('http-proxy');
const acme = require('acme-client');
const forge = require('node-forge'); forge.options.usePureJavaScript = true;

//

const AppPackage = require('./package.json');
const AppMeta = _.merge(AppPackage, { Version: AppPackage.version || process.env.npm_package_version || '0.0.0', Name: AppPackage.namelong || AppPackage.name || 'App', NameTag: AppPackage.nametag || AppPackage.name.toUpperCase(), Info: AppPackage.description || '' });
AppMeta.Full = AppMeta.Name + ': ' + AppMeta.Info + ' [' + AppMeta.Version + ']';

//

const AppArgy = yargs(process.argv).wrap(75).help(false).version(false)
	.usage("\n" + AppMeta.Full + "\n\n" + 'USAGE: node $0 [options]')
	.group('loglevel', 'Log').describe('loglevel', 'Log Level').default('loglevel', 'info')
	.group('logpretty', 'Log').describe('logpretty', 'Log Pretty').boolean('logpretty').default('logpretty', true)
	.describe('ip', 'Bind IP').default('ip', '0.0.0.0')
	.describe('port', 'Backend Bind Port').default('port', 89)
	.describe('port80', 'HTTP Bind Port').default('port80', 80)
	.describe('port443', 'HTTPS Bind Port').default('port443', 443)
	.describe('acme', 'ACME Endpoint').default('acme', 'letsencrypt-production')
	.describe('private', 'Private IP').default('private', null)
	.describe('public', 'Public IP').default('public', null).array('public')
	.describe('admin', 'Admin IP').default('admin', null).array('admin')
	.describe('datapath', 'Data Path').default('datapath', '/webgate')
	.group('to', 'Proxy Map').describe('to', 'Map To').default('to', 'INFO').array('to')
	.group('from', 'Proxy Map').describe('from', 'Map From').default('from', null).array('from')
	.group('map', 'Proxy Map').describe('map', 'Map Text').default('map', null)
	.group('mapfile', 'Proxy Map').describe('mapfile', 'Map File').default('mapfile', null)
	.demandOption([])

//

const AppArgs = AppArgy.argv;
const App = {
	Meta: AppMeta,
	Args: AppArgs,
	Port: AppArgs.port,
	IP: AppArgs.ip,
	AdminIP: AppArgs.admin,
	PublicIP: AppArgs.public,
	PrivateIP: AppArgs.private,
	DataPath: AppArgs.datapath,
}

//

App.Exit = function (z, data) {
	let exit = { code: 0, error: false, silent: false, message: 'App.Exit' };
	if (z && z.stack) { exit.error = z; exit.code = 1; exit.msg = 'App.Exit ' + chalk.white(z.message); z.message = exit.msg; LOG.ERROR(z); LOG.ERROR(exit.msg, _.merge({ ExitCode: exit.code }, data)); }
	else {
		if (Number.isInteger(z)) { exit.code = z; } else if (typeof (z) == 'string') { exit.message = 'App.Exit ' + chalk.white(z); } else if (z) { exit = z; }
		if (!exit.silent) { LOG.DEBUG(exit.message, _.merge({ ExitCode: exit.code }, data)); }
	}
	process.exit(exit.code);
}

App.InfoDB = {}; App.Info = function (id) { let z = App.InfoDB[id]; if (!z) { return z; } else { return z.Type == 'FX' ? z.Value() : z.Value; } };
App.SetInfo = function (id, value) { if (typeof (value) == 'function') { return App.InfoDB[id] = { Type: 'FX', Value: value } } else { return App.InfoDB[id] = { Type: 'VALUE', Value: value } } };
App.SetInfo('Node.Args', process.argv.join(' '));
App.SetInfo('Node', require('os').hostname().toUpperCase() + ' : ' + process.pid + '/' + process.ppid + ' : ' + process.cwd() + ' : ' + process.version + ' : ' + require('os').version() + ' : ' + process.title);
App.SetInfo('App', App.Meta.Full);

App.LogPretty = false; if (App.Args.logpretty) { App.LogPretty = { colorize: true, singleLine: true, translateTime: 'SYS:yyyy-mm-dd.HH:MM:ss', ignore: 'hostname,pid', messageFormat: function (log, key, label) { let msg = log.msg ? log.msg : ''; let logout = chalk.gray(App.Meta.NameTag); if (msg != '') { logout += ' ' + msg }; return logout; } }; }
App.Log = pino({ level: App.Args.loglevel, hooks: { logMethod: function (args, method) { if (args.length === 2) { args.reverse() } method.apply(this, args) } }, prettyPrint: App.LogPretty });
const LOG = App.Log; LOG.TRACE = LOG.trace; LOG.DEBUG = LOG.debug; LOG.INFO = LOG.info; LOG.WARN = LOG.warn; LOG.ERROR = LOG.error; LOG.FATAL = LOG.fatal;
if (App.Args.debuglogger) { LOG.TRACE('TRACE'); LOG.DEBUG('DEBUG'); LOG.INFO('INFO'); LOG.WARN('WARN'); LOG.ERROR('ERROR'); LOG.FATAL('FATAL'); App.Exit({ silent: true }); }
if (App.Args.debugargs) { console.log("\n"); console.log(App.Args); console.log("\n"); App.Exit({ silent: true }); };
if (App.Args.help) { AppArg.showHelp('log'); console.log("\n" + App.Info('Node') + "\n"); App.Exit({ silent: true }); }
if (App.Args.version) { console.log(App.Meta.Version); App.Exit({ silent: true }); }

//

App.Init = function () {
	if (App.Args.map || App.Args.mapfile) { App.Args.to = ['MAP']; }

	App.SetInfo('App', function () { return 'DATA = ' + App.DataPath + ' | ADMIN = ' + (App.AdminIP[0] ? App.AdminIP.join(' ') : 'NONE') + ' | PROXY = ' + App.IP + ' < ' + (App.PrivateIP ? App.PrivateIP : '?') + ' < ' + (App.PublicIP[0] ? App.PublicIP.join(' ') : 'ANY') + (App.Args.from[0] ? ' : ' + App.Args.from.join(' ') + ' ' : ' : ALL ') + (App.Args.to[0] ? '> ' + App.Args.to.join(' ') + ' ' : ''); });

	LOG.TRACE({ App: App });
	LOG.INFO(App.Meta.Full);
	LOG.DEBUG('Node.Info: ' + chalk.white(App.Info('Node')));
	LOG.DEBUG('Node.Args: ' + chalk.white(App.Info('Node.Args')));
	LOG.INFO('App.Info: ' + chalk.white(App.Info('App')));

	App.InitData();
	App.InitMap();
	App.InitProxy();
	App.InitServer();
	App.InitBackend(App.InitDone);
}

App.InitData = function () {
	LOG.DEBUG('App.InitData');

	App.Clients = {};
	App.Server = {};

	App.Requests = 0;
	App.Stats = { Max: { Sockets: { HTTP: 0, HTTPS: 0 } }, Hits: { Host: {}, IP: {}, Total: { HTTP: 0, HTTPS: 0 } } };

	App.CertDB = function () { };
	App.CertDB.Data = {};
	App.CertReqs = {};

	App.ACME = { Endpoints: { 'letsencrypt-staging': acme.directory.letsencrypt.staging, 'letsencrypt-production': acme.directory.letsencrypt.production, 'zerossl': 'https://acme.zerossl.com/v2/DV90' } };
	App.ACME.Endpoint = App.ACME.Endpoints[App.Args.acme] ? App.ACME.Endpoints[App.Args.acme] : App.Args.acme;

	if (!fs.existsSync(App.DataPath)) { LOG.WARN('DataPath.CreateMissing: ' + App.DataPath); try { fs.mkdirSync(App.DataPath + '/WWW', { recursive: true }); } catch (ex) { App.Exit(Error('DataPath.CreateFailed: ' + App.DataPath)); } }
	try { fs.writeFileSync(App.DataPath + '/0', '0'); } catch (ex) { App.Exit(Error('DataPath.NoWriteAccess: ' + App.DataPath)); } finally { fs.rmSync(App.DataPath + '/0'); }
	fs.writeFileSync(App.DataPath + '/WWW/favicon.ico', 'AAABAAEAEBAQAAAAAAAoAQAAFgAAACgAAAAQAAAAIAAAAAEABAAAAAAAwAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAACAAACAAAAAgIAAgAAAAIAAgACAgAAAwMDAAICAgAAAAP8AAP8AAAD//wD/AAAA/wD/AP//AAD///8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4H///5mf//9gb//+xjf//gYH//126//9P8v//Q8L//0PC//9P8v//Xbr//4GB//+xjf//2Bv//+Zn///4H///', 'base64');
	fs.writeFileSync(App.DataPath + '/WWW/favicon.ico', 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkVykhpFcpvKRXKcikVyk6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApFcpl6RXKf+kVyn/pFcpwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAApFcpMaRXKaOkVyn/pFcp/6RXKcOkVykmAAAAAAAAAAAAAAAAAAAAAAAAAACkVyklpFcpsqRXKbCkVyk9pFcpbqRYKj7oyK5Gz5+B5seUc/DkwqlKpFgqR6RXKWykVylppFcp2qRXKbqkVykWpFcpr6RXKf+kVyn/pFcpvObFrUXoyK/E6Miv/924nf/XrZD/6Miv/+jIr7/mxa07pFcp6aRXKf+kVyn/pFcpeaRXKY6kVyn/pFcp/8SNbfnoyK//6Miv/+jIr//dt5z/162R/+jIr//oyK//6Miv/rl8WP2kVyn/pFcp/KRXKUakVykFpFcpcKRXKXvnxq3c6Miv/+jIr//hvaT/vH9d/7h6Vv/euZ7/6Miv/+jIr//mxKy2pFcpg6RXKTYAAAAAAAAAAKRXKSWkVylA6Miv1ejIr//oyK//uXxZ/6RXKv+kVyr/s3FL/+jIr//oyK//6MivsKRXKVSkVykQAAAAAAAAAACkVykhpFcpQ+jIr9PoyK//6Miv/7RzTv+kVyr/pFcq/61pQf/ox67/6Miv/+jIr7CkVylSpFcpFAAAAAAAAAAApFcpMaRXKWDoyK/Q2rOX/8qZev/Wq47/vIBd/7p9Wv/Vqo3/y5p6/9Wqjf/jwqi6pFcplqRXKXKkVykGpFcpRaRXKfmkVyn/tnhS+deukv/oyK//6Miv/+jIr//oyK//6Miv/+jIr//duJ39sGxF9aRXKf+kVyn/pFcphKRXKY6kVyn/pFcp/6RXKdboyK9E6MivyejIr//oyK//6Miv/+jIr/7oyK+16MivL6RXKbOkVyn/pFcp/6RXKZWkVykrpFcp3aRXKfKkVymFpFcpaqZcMBnoyK9S2bGW6diwlODoyK8+pFcpFqRXKWqkVylcpFcpoqRXKZukVykWAAAAAKRXKQGkVykDAAAAAKRXKQSkVylWpFcpnqRXKf+kVyn/pFcpoKRXKVikVykEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAKRXKa6kVyn/pFcp/6RXKbIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACkVyk3pFcp2KRXKdmkVyk6AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/D+cQfw/nEH4H5xBAACcQQAAnEEAAJxBAAGcQYABnEGAAZxBgACcQQAAnEEAAJxBAACcQZAPnEH8P5xB/D+cQQ==');
}

App.InitDone = function () {
	LOG.DEBUG('App.InitDone');

	if (true) {
		if (!App.PublicIP[0] || (App.PublicIP[0] == 'SKIPDNS')) { LOG.WARN('ACME.Warning: With no MAP FROM entries found, and also no PublicIP set, every new host seen will generate certificate requests!!'); }
		else { LOG.WARN('ACME.Warning: With no MAP FROM entries found, any host that resolves to your PublicIP will generate certificate requests: ' + App.PublicIP); }
	}

	if (App.Args.initonly) { App.Exit('App.InitOnly: Exiting Now'); return; }
	setTimeout(App.Main, 9);
}

//

App.Main = function () {
	LOG.DEBUG('App.Main');
}

//

App.InitMap = function () {
	LOG.DEBUG('App.InitMap');

	let map = {
		//ALL: 404
		//ALL: 'PROXY',
		//ALL: 'INFO',
		ELSE: 404,
		'google.com': 'PROXY',
		'*/zx/px/port/9003': 'http://localhost:9003',
		'*/zx/px/port/9006': 'http://localhost:9006',
		'!/': 'INFO',
		'!/favicon.ico': 'BACKEND',
		'*/.well-known/': 'BACKEND',
		//'local.zxdns.net/': 'http://google.com',
		'example.com': '>https://en.wikipedia.org/wiki/Example.com',
		'example.org': 'BACKEND',
		'localhost': 'BACKEND',
	};

	maptest = {
		//'*': 'http://localhost:1',
		//'!': 'http://localhost:2',
		//'*/*': 'http://localhost:3',
		//'*/!': 'http://localhost:4',
		//'!/*': 'http://localhost:5',
		//'!/!': 'http://localhost:6',
		//'LOCALHOST/': 'http://localhost:10',
		//LOCALHOST: 'http://localhost:9',
	};

	if (map['!']) { map['ELSE'] = map['!']; delete map['!']; }
	if (map['*']) { map['ALL'] = map['*']; delete map['*']; }
	//if (map.ALL) { map = { ALL: map.ALL }; }

	let mapcount = 0; let hostcount = 0;
	let mapout = {}; let mapkeys = Object.keys(map);
	for (let i = 0; i < mapkeys.length; i++) {
		let k = mapkeys[i]; let v = map[k];

		let u = k;
		if (k == 'ALL') { mapout['ALL'] = v; mapcount++; LOG.TRACE('Proxy.Map: Adding Route: ALL => ' + v); }
		else if (k == 'ELSE') { mapout['ELSE'] = v; mapcount++; LOG.TRACE('Proxy.Map: Adding Route: ELSE => ' + v); }
		else if (k.startsWith('*')) {
			if (!mapout['WILDCARD']) { mapout['WILDCARD'] = {} }
			if (k == '*/*') { mapout['WILDCARD']['*'] = v; } else { mapout['WILDCARD'][k.substr(1)] = v; }
			mapcount++; LOG.TRACE('Proxy.Map: Adding Route: WILDCARD: ' + k + ' => ' + v);
		}
		else if (k.startsWith('!')) {
			if (!mapout['WILDELSE']) { mapout['WILDELSE'] = {} }
			if (k == '!/*') { mapout['WILDELSE']['*'] = v; } else { mapout['WILDELSE'][k.substr(1)] = v; }
			mapcount++; LOG.TRACE('Proxy.Map: Adding Route: WILDELSE: ' + k + ' => ' + v);
		}
		else {
			if (!k.includes(':')) { k = 'http://' + k };
			let u = new URL(k); let up = u.pathname; let uh = u.host.toUpperCase();
			if (!mapout[uh]) { mapout[uh] = {}; hostcount++; }
			if (k.substr(-1) == '/') { up = '/'; } else { if (k != u.protocol + '//' + uh + u.pathname) { up = '!'; } }
			if (mapout[uh][up]) { LOG.WARN('Proxy.Map: Redefined Route: ' + k + ' => ' + v); }
			else { mapcount++; LOG.TRACE('Proxy.Map: Adding Route: HOST: ' + k + ' => ' + v); }
			mapout[uh][up] = v;
		}
	}

	let maptext = 'ELSE: INFO';
	LOG.INFO('Proxy.Map: ' + hostcount + ' Hosts / ' + mapcount + ' Routes' + "\n" + chalk.white(maptext) + "\n" + chalk.white(util.inspect(mapout, { colors: true, depth: null, breakLength: 1 })));

	App.Map = mapout;
}

App.InitProxy = function () {
	LOG.DEBUG('App.InitProxy');
	App.InitProxyServer();
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

App.GetHostSlug = function (host) { let slug = host.replace(/\./g, '_').toUpperCase(); let z = slug.split('_'); if (z.length >= 3) { slug = z.slice(-2).join('_') + '_' + z.slice(0, z.length - 2).reverse().join('_'); }; return slug; };
App.GetSlugHost = function (slug) { let host = slug.replace(/_/g, '.'); let z = slug.split('_'); if (z.length >= 2) { host = z.slice(2).reverse().join('.') + '.' + z.slice(0, 2).join('.'); }; return host; };

//

App.InitBackend = function (cb) {
	LOG.DEBUG('App.InitBackend');

	App.Backend = { Endpoint: 'http://' + App.IP + ':' + App.Port, Fastify: fastify({ logger: App.Log, maxParamLength: 999, ignoreTrailingSlash: false, }) };

	let ff = App.Backend.Fastify;
	ff.register(fastify_compress);
	ff.register(fastify_static, { root: App.DataPath + '/WWW', list: false });

	fs.mkdirSync(App.DataPath + '/WWW/.well-known/acme-challenge', { recursive: true });
	fs.writeFileSync(App.DataPath + '/WWW/.well-known/acme-challenge/acme.txt', 'ACME');

	ff.addHook('onRequest', (req, rep, nxt) => {
		let reqip = req.socket.remoteAddress;
		App.Requests++; if (!App.Clients[reqip]) { App.Clients[reqip] = 1; } else { App.Clients[reqip]++; }
		nxt();
	})

	//ff.setNotFoundHandler((req,rep) => { rep.redirect('/404'); });
	ff.setNotFoundHandler((req, rep) => { rep.code(404).send('404'); });

	ff.get('/', (req, rep) => { rep.send(App.Meta.Name); });

	ff.get('/zx/px/acme', (req, rep) => {
		LOG.WARN('PX.Acme'); LOG.DEBUG({ IP: req.socket.remoteAddress, Q: req.query, A: App.AdminIP });
		if (!App.AdminIP.includes(req.socket.remoteAddress)) { return rep.send('NO'); }
		let acmedomain = 'localhost'; if (req.query.acme) { acmedomain = req.query.acme; }
		rep.send('PX:ACME:' + req.hostname + "\n" + App.GetCert(acmedomain));
	})

	ff.log.infomute = ff.log.info; ff.log.info = ff.log.trace; ff.listen(89, '127.0.0.1', (err, address) => { ff.log.info = ff.log.infomute; if (err) { LOG.ERROR(err); } else { App.BackendStatus = 'UP'; setTimeout(cb, 9); } });
}

//

App.InitProxyServer = function () {
	App.Proxy = nodeproxy.createProxyServer({});

	App.Proxy.on('open', function (socket) { });
	App.Proxy.on('close', function (socket) { });

	App.Proxy.on('error', function (err, req, res) { LOG.ERROR(err); res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end('PX:ERROR:HTTP:' + "\n" + err); });

	App.Proxy.on('proxyReq', function (proxyReq, req, res, options) {
		LOG.DEBUG({ PREQ: { H: proxyReq.headers, U: proxyReq.url, P: proxyReq.protocol, PP: proxyReq.socket.encrypted }, REQ: { H: req.headers, U: req.url, PP: req.socket.encrypted }, RES: { H: res.headers, P: res.protocol, S: res.statusCode } });
		//proxyReq.removeHeader('X-Forwarded-For'); proxyReq.setHeader('X-Forwarded-For', req.socket.remoteAddress);
		//proxyReq.removeHeader('x-forwarded-for'); proxyReq.setHeader('x-forwarded-for', req.socket.remoteAddress);
	})

	App.Proxy.on('proxyRes', function (proxyRes, req, res, options) {
		LOG.DEBUG({ PRES: { H: proxyRes.headers, U: proxyRes.url, P: proxyRes.protocol, S: proxyRes.statusCode }, REQ: { H: req.headers, U: req.url, PP: req.socket.encrypted }, RES: { H: res.headers, P: res.protocol, S: res.statusCode } });
	})
}

//

App.ServerHander = function (req, res) {
	let stype = 'HTTP'; if (req.socket.encrypted) { stype = 'HTTPS'; } let stypelc=stype.toLowerCase();
	
	req.host = req.headers.host || 'NOHOST'; req.hostuc = req.host.toUpperCase();
	req.ip = req.socket.remoteAddress;
	req.admin = App.AdminIP.includes(req.ip) || false;
	req.urlz = false; try { req.urlz = new URL(req.url); } catch (ex) { }

	delete req.headers['X-Forwarded-For']; req.headers['x-forwarded-for'] = req.ip;

	App.Stats.Hits.Total[stype]++;
	if (!App.Stats.Hits.Host[req.hostuc]) { App.Stats.Hits.Host[req.hostuc] = 1 } else { App.Stats.Hits.Host[req.hostuc]++ }
	if (!App.Stats.Hits.IP[req.ip]) { App.Stats.Hits.IP[req.ip] = 1 } else { App.Stats.Hits.IP[req.ip]++ }
	if (App.Server[stype]._connections > App.Stats.Max.Sockets[stype]) { App.Stats.Max.Sockets[stype] = App.Server[stype]._connections }

	let reqhost = (req.headers.host || 'NXDOMAIN').toUpperCase();
	let port = 9001;
	let target = false; // ='http://'+App.Args.toip+':'+port;

	let toip = App.Args.toip || '127.0.0.1';
	if (req.url.startsWith('/.well-known')) { target = 'http://' + toip + ':89'; }

	let to = toip;

	LOG.DEBUG({ REQ: { HOST: req.host, URL: req.url } });

	if (req.url.startsWith('http://') || req.url.startsWith('https://')) { 
		req.isforproxy = true; req.url = req.urlz.pathname; 
	}

	let url = stypelc + '://' + req.host + req.url;

	LOG.TRACE(chalk.white(req.ip) + ' ' + req.method + ' ' + url, { Admin: req.admin, Open: { HTTP: App.Server.HTTP._connections, HTTPS: App.Server.HTTPS._connections } });
	LOG.TRACE(chalk.white(req.ip) + ' ' + req.method + ' ' + url, { Admin: req.admin, Method: req.method, URL: url, Headers: req.headers });
	LOG.TRACE({ Stats: App.Stats });

	if (1 && req.admin) {
		if (req.url.startsWith('/zx/px/port/')) { target = 'http://' + to + ':' + req.url.split('/').splice(4); }
		if (req.url.startsWith('/zx/px/http/')) { let goto = req.url.split('/').splice(4).join('/'); req.url = '/'; target = 'http://' + goto; }
		if (req.url.startsWith('/zx/px/https/')) { let goto = req.url.split('/').splice(4).join('/'); req.url = '/'; target = 'https://' + goto; }
	}

	if (req.url.startsWith('/blog')) { req.url = req.url.substr(5); target = 'http://' + toip + ':9001'; }
	else if (req.url.startsWith('/blog/')) { req.url = req.url.substr(6); target = 'http://' + toip + ':9001'; }

	let mapout = App.Map;

	let u = new URL(url); let uhost = u.host.toUpperCase();
	let t = false;

	if (mapout.ALL) { t = mapout.ALL; }

	if (mapout.WILDCARD) {
		if (!t) { t = mapout.WILDCARD[u.pathname]; }
		if (!t) { let kz = Object.keys(mapout.WILDCARD); for (let i = 0; i < kz.length; i++) { let k = kz[i]; console.log(k); if (u.pathname.startsWith(k)) { t = mapout.WILDCARD[k]; } } }
	}

	if (mapout[uhost]) {
		console.log('MAP: ' + uhost);
		if (!t) { t = mapout[uhost]['*']; }
		if (!t) { t = mapout[uhost][u.pathname]; }
		if (!t) { let kz = Object.keys(mapout[uhost]); for (let i = 0; i < kz.length; i++) { let k = kz[i]; console.log(k); if (u.pathname.startsWith(k)) { t = mapout[uhost][k]; } } }
		if (!t) { t = mapout[uhost]['!']; }
	}

	if (mapout.WILDELSE) {
		if (!t) { t = mapout.WILDELSE[u.pathname]; }
		if (!t) { let kz = Object.keys(mapout.WILDELSE); for (let i = 0; i < kz.length; i++) { let k = kz[i]; console.log(k); if (u.pathname.startsWith(k)) { t = mapout.WILDELSE[k]; } } }
	}

	if (!t) { t = mapout.ELSE; }
	if (!t) { t = 'NOMAP'; }

	if (req.isforproxy && t!='PROXY') { t=403; }

	if (t=='OK') { t=200; }
	if (t=='NOMAP') { t=404; }

	// t = target;
	let logto = t; if (typeof t=='number') { logto = t + ' = ' + http.STATUS_CODES[t].toUpperCase(); }
	LOG.DEBUG(chalk.white(req.ip) + ' ' + (req.isforproxy?'PROXY ':'') + req.method + ' ' + u.href + chalk.white(' => ') + logto + ((LOG.level == 'trace') ? "\n" : ''));

	if (t == 'HANGUP') { res.statusCode = 502; res.shouldKeepAlive = false; res.socket.end(); res.end(); }
	// else if (req.isforproxy && t!='PROXY') { res.statusCode = 502; res.shouldKeepAlive = false; res.socket.end(); res.end(); }
	else if (typeof (t) == 'number') { res.statusCode = t; res.end(); }
	else if (t == 'PROXY') { App.Proxy.web(req, res, { target: req.url }); }
	else if (t == 'BACKEND') { App.Proxy.web(req, res, { target: App.Backend.Endpoint }); }
	else if (t == 'INFO') {
		try { res.end(req.method + ' ' + stype.toLowerCase() + '://' + req.host + '' + req.url + "\n" + (new Date().toISOString()) + "\n" + req.headers['user-agent'] + "\n" + req.ip + "\n"); } catch (ex) { LOG.ERROR(ex); }
	}
	else if (t.startsWith('>')) {
		t = t.substring(1);
		if (!t.includes(':')) { t = 'http://' + t };
		res.writeHead(301, { Location: new URL(t).href });
		res.end();
	}
	else {
		if (!t.includes(':')) { t = 'http://' + t };
		try { App.Proxy.web(req, res, { target: t, followRedirects: true, changeOrigin: true }); } catch (ex) { LOG.ERROR(ex); }
	}
}

//

App.SNI = function (host, cb) {
	host = host.toUpperCase();
	LOG.TRACE('SNI: ' + host);
	if (App.PublicIP.includes(host) || (host == 'LOCALHOST') || (host == App.PrivateIP) || (host == App.IP)) { cb(null, App.GetCert('LOCALHOST').Context); return; }

	let cert = App.GetCert(host);
	if (cert) { cb(null, cert.Context); return; }
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
				} catch (ex) { LOG.ERROR(ex); }
			});
		}
	}
}

//

App.GetCert = function (domain) {
	domain = domain.toUpperCase();
	LOG.TRACE('GetCert: ' + domain);
	if (App.CertDB.Data[domain]) { LOG.TRACE('GetCert.Cached: ' + domain); return App.CertDB.Data[domain]; }
	else {
		let slug = App.GetHostSlug(domain);
		if (!fs.existsSync(App.DataPath + '/' + slug + '/keys/key') || !fs.existsSync(App.DataPath + '/' + slug + '/keys/crt')) { LOG.DEBUG('GetCert.Missing: ' + domain); return false; }
		LOG.INFO('GetCert.LoadFile: ' + domain);
		let key = undefined; try { key = fs.readFileSync(App.DataPath + '/' + slug + '/keys/key'); } catch (ex) { }
		let crt = undefined; try { crt = fs.readFileSync(App.DataPath + '/' + slug + '/keys/crt'); } catch (ex) { }
		let csr = undefined; try { csr = fs.readFileSync(App.DataPath + '/' + slug + '/keys/csr'); } catch (ex) { }
		let context = tls.createSecureContext({ key: key, cert: crt });
		return App.CertDB.Data[domain] = { Domain: domain, Context: context, KEY: key, CRT: crt, CSR: csr };
	}
}

App.WriteCert = function (slug, cert) {
	fs.mkdirSync(App.DataPath + '/' + slug + '/keys', { recursive: true });
	if (cert.KEY) { fs.writeFileSync(App.DataPath + '/' + slug + '/keys/key', cert.KEY); }
	if (cert.CRT) { fs.writeFileSync(App.DataPath + '/' + slug + '/keys/crt', cert.CRT); }
	if (cert.CSR) { fs.writeFileSync(App.DataPath + '/' + slug + '/keys/csr', cert.CSR); }
}

App.MakeCert = function (domain) {
	domain = domain.toUpperCase();
	let slug = App.GetHostSlug(domain);
	LOG.WARN('MakeCert: ' + domain);

	var attrs = [{ name: 'commonName', value: domain }];
	let pki = forge.pki; let keys = pki.rsa.generateKeyPair(2048); let cert = pki.createCertificate();
	cert.publicKey = keys.publicKey; cert.serialNumber = '01';
	cert.validity.notBefore = new Date();
	cert.validity.notAfter = new Date('2099-12-31T23:59:59'); //cert.validity.notAfter = new Date(); cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear()+10);
	cert.setSubject(attrs); cert.setIssuer(attrs); cert.sign(keys.privateKey);
	let key = forge.pki.privateKeyToPem(keys.privateKey);
	var crt = pki.certificateToPem(cert);

	App.WriteCert(slug, { KEY: key, CRT: crt });
	return App.GetCert(domain);
}

App.RequestCert = function (domain, cb) {
	if (!cb) { cb = function () { } }
	domain = domain.toUpperCase(); let slug = App.GetHostSlug(domain);
	if (App.CertReqs[domain]) { LOG.TRACE('RequestCert.AlreadySent: ' + domain); cb(null, Error('SNI:BUSY')); return; }
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
		let crt = false;
		try { crt = await client.auto({ csr: csr, challengeCreateFn: acmeCreate, challengeRemoveFn: acmeRemove, termsOfServiceAgreed: true, email: 'contact@' + domain }); }
		catch (ex) { LOG.WARN({ msg: 'RequestCert.Failed: ' + domain + ' = ACME: ' + ex.message }); cb(null, Error('SNI:ACMEFAIL')); return; }
		if (crt) { LOG.INFO('RequestCert.Success: ' + domain); App.WriteCert(slug, { CRT: crt }); cb(null, App.GetCert(domain).Context); return; }
	}
	try { afx(); } catch (ex) { LOG.ERROR(ex); }
}

//

App.Init();