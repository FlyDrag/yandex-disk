exports.YandexDisk = YandexDisk;

var DomJS = require('dom-js');

function YandexDisk(login, password) {
    if (arguments.length < 2) {
        this._auth = 'OAuth ' + login;
    } else {
        this._auth = 'Basic ' + new Buffer(login + ':' + password, 'utf8').toString('base64');
    }
    this._workDir = '/';
}

YandexDisk.prototype = {
    cd: function(path) {
        this._workDir = this._normalizePath(path);
    },
    
    writeFile: function(path, content, encoding, callback) {
        var body = new Buffer(content, encoding);
        var headers = {
            'Expect': '100-continue',
            'Content-Type': 'application/binary',
            'Content-Length': body.length
        };
        this._request('PUT', path, headers, body, null, function(err) {
            return callback(err);
        });
    },

    uploadFile: function(srcFile, targetPath, callback) {
        var that = this;
        require('fs').readFile(srcFile, function(err, body) {
            if (err) {
                return callback(err);
            }
            that.writeFile(targetPath, body, 'binary', callback);
        });
    },

    exists: function(path, callback) {
        this._request('PROPFIND', path, {Depth: 0}, null, null, function(err) {
            if (err) {
                if (err.message == 'Not found') {
                    return callback(null, false);
                }
                return callback(err);
            }
            return callback(null, true);
        });
    },

    mkdir: function(dirname, callback) {
        this._request('MKCOL', dirname, null, null, null, function(err, response) {
            if (err) {
                return callback(err);
            }
            return callback(null, response != 'mkdir: folder already exists');
        });
    },

    readdir: function(path, callback) {
        this._request('PROPFIND', path, {Depth: 1}, null, 'utf8', function(err, response) {
            if (err) {
                return callback(err);
            }
            try {
                new DomJS.DomJS().parse(response, function(err, root) {
                    if (!err) {
                        try {
                            var dir = [];
                            root.children.forEach(function(node) {
                                if (node.name == 'd:response') {
                                    dir.push({
                                        href: getNodeValue(node, 'd:href'),
                                        displayName: getNodeValue(node, 'd:displayname'),
                                        creationDate: getNodeValue(node, 'd:creationdate'),
                                        isDir: !!getNodes(node, 'd:collection').length,
                                        size: getNodeValue(node, 'd:getcontentlength'),
                                        lastModified: getNodeValue(node, 'd:getlastmodified')
                                    });
                                }
                            }, this);
                            // Первым всегда идёт сама директория, она нам в этом месте не нужна
                            dir.shift();
                            return callback(null, dir);
                        } catch (e) {
                            return callback(e);
                        }
                    }
                });
            } catch (e) {
                return callback(e);
            }
        });
    },


    _normalizePath: function(path) {
        return path.indexOf('/') == 0 ? path : require('path').join(this._workDir, path).replace(/\\/g, '/');
    },

    _request: function(method, path, headers, body, responseEncoding, callback) {
        var options = {
            host: 'webdav.yandex.ru',
            port: 443,
            method: method.toUpperCase(),
            path: encodeURI(this._normalizePath(path)),
            headers: {
                'Host': 'webdav.yandex.ru',
                'Accept': '*/*',
                'Authorization': this._auth
            }
        };
        Object.keys(headers || {}).forEach(function(header) {
            options.headers[header] = headers[header];
        });

        var req = require('https').request(options, function(res) {
            var code = res.statusCode;
            if (code == 401) {
                return callback(new Error('Auth error'));
            }
            if (code == 404) {
                return callback(new Error('Not found'));
            }
            if (code == 409) {
                return callback(new Error('Conflict'))
            }
            var response = '';
            res.setEncoding(responseEncoding || 'binary');
            res.on('data', function(chunk) {
                response += chunk;
            });
            res.on('end', function() {
                callback(null, response);
            });
        });
        if (body) {
            req.write(body);
        }
        req.on('error', function(err) {
            callback(err);
        });
        req.end();
    }
};

function getNodeValue(root, nodeName) {
    var nodes = getNodes(root, nodeName);
    return nodes.length ? nodes[0].text() : '';
}

function getNodes(root, nodeName) {
    var res = [];
    root.children.forEach(function(node) {
        if (node instanceof DomJS.Element) {
            if (nodeName == '*' || node.name == nodeName) {
                res.push(node);
            }
            [].push.apply(res, getNodes(node, nodeName));
        }
    }, this);
    return res;
}