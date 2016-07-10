'use strict';

var Path = require('path');
var fs = require('fs');
var express = require('express');
var proxyquire = require('proxyquire').noPreserveCache();
var extend = require('extend');
var sinon = require('sinon');

var expect = require('unexpected')
  .clone()
  .installPlugin(require('unexpected-express'));

var root = Path.resolve(__dirname, '../fixtures');


var getJspmApp = function (options) {
  return express()
    .use(require('../lib/index')(extend({
      serverRoot: root,
      bundle: false
    }, options)))
    .use(express.static(root));
};

var getBuilderApp = function (options) {
  return express()
    .use(proxyquire('../lib/index', { 'jspm': null })(extend({
      serverRoot: root,
      baseUrl: root,
      configFile: 'config.js',
      bundle: false
    }, options)))
    .use(express.static(root));
};

it('should throw when neither jspm or systemjs-builder are installed', function () {
  return expect(function () {
    proxyquire('../lib/index', { 'jspm': null, 'systemjs-builder': null })();
  }, 'to throw');
});

function runtests(getApp, description) {
  describe(description, function () {
    it('should be defined', function () {
      return expect(getApp(), 'to be a function');
    });


    describe('when requesting files without the systemjs accepts header', function () {
      it('should pass javascript through unmodified', function () {
        return expect(getApp(), 'to yield exchange', {
          request: '/default.js',
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/javascript'
            },
            body: 'console.log(\'hello world\');\n'
          }
        });
      });

      it('should pass html through unmodified', function () {
        return expect(getApp(), 'to yield exchange', {
          request: '/default.html',
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/html; charset=UTF-8'
            },
            body: '<h1>Hello World</h1>\n'
          }
        });
      });

      it('should pass css through unmodified', function () {
        return expect(getApp(), 'to yield exchange', {
          request: '/default.css',
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': 'text/css; charset=UTF-8'
            },
            body: 'body { color: hotpink; }\n'
          }
        });
      });
    });

    describe('when requesting files with the systemjs accepts header', function () {
      it('should compile javascript', function () {
        return expect(getApp(), 'to yield exchange', {
          request: {
            url: '/default.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': /^application\/javascript/
            },
            body: expect.it('to begin with', 'System.registerDynamic([]').and('to contain', 'console.log(\'hello world\');\n')
          }
        });
      });

      it('should handle commonjs', function () {
        return expect(getApp(), 'to yield exchange', {
          request: {
            url: '/lib/stringExport.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': /^application\/javascript/
            },
            body: expect.it('to begin with', 'System.registerDynamic([]').and('to contain', 'module.exports = \'foo\';\n')
          }
        });
      });

      it('should handle commonjs imports', function () {
        return expect(getApp(), 'to yield exchange', {
          request: {
            url: '/lib/requireWorking.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': /^application\/javascript/
            },
            body: expect.it('to begin with', 'System.registerDynamic(["./stringExport"]').and('to contain', 'var foo = $__require(\'./stringExport\');\n  module.exports = {foo: foo};\n')
          }
        });
      });

      it('should pass uncompileable errors through to the client', function () {
        return expect(getApp(), 'to yield exchange', {
          request: {
            url: '/lib/broken.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            errorPassedToNext: /Unterminated String Literal/,
            statusCode: 500
          }
        });
      });

      it('should handle commonjs imports of broken assets', function () {
        return expect(getApp(), 'to yield exchange', {
          request: {
            url: '/lib/requireBroken.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': /^application\/javascript/
            },
            body: expect.it('to begin with', 'System.registerDynamic(["./broken"]').and('to contain', 'var foo = $__require(\'./broken\');\n  module.exports = {foo: foo};\n')
          }
        });
      });

      it('should handle jspm modules', function () {
        return expect(getApp(), 'to yield exchange', {
          request: {
            url: '/jspm_packages/github/components/jquery@2.1.4.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            headers: {
              'Content-Type': /^application\/javascript/
            },
            body: expect.it('to begin with', '(function() {\nvar define = System.amdDefine;\ndefine(["github:components/jquery@2.1.4/jquery"]')
          }
        });
      });

      it('should return a 304 status code if ETag matches', function () {
        var app = getApp();

        return expect(app, 'to yield exchange', {
          request: {
            url: '/default.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: 200
        })
        .then(function (context) {
          return expect(app, 'to yield exchange', {
            request: {
              url: '/default.js',
              headers: {
                accept: 'application/x-es-module */*',
                'If-None-Match': context.res.get('etag')
              }
            },
            response: 304
          });
        });
      });

    });

    describe('when requesting the SystemJS config file', function () {
      it('should augment the config with an empty depCache when no modules have been translated', function () {
        var stub = sinon.stub(console, 'error');

        return expect(getApp({ depCache: true }), 'to yield exchange', {
          request: {
            url: '/config.js'
          },
          response: {
            body: expect.it('to contain', 'depCache: {}')
          }
        })
        .finally(stub.restore);
      });

      it('should augment the config with an empty depCache after serving a module with no dependencies', function () {
        var stub = sinon.stub(console, 'error');
        var app = getApp({ depCache: true });

        return expect(app, 'to yield exchange', {
          request: {
            url: '/default.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: 200
        })
        .then(function () {
          return expect(app, 'to yield exchange', {
            request: {
              url: '/config.js'
            },
            response: {
              body: expect.it('to contain', 'depCache: {}')
            }
          });
        })
        .finally(stub.restore);
      });

      it('should augment the config with depCache representing the translated modules dependency tree', function () {
        var stub = sinon.stub(console, 'error');
        var app = getApp({ depCache: true });

        return expect(app, 'to yield exchange', {
          request: {
            url: '/lib/requireWorking.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: 200
        })
        .delay(10)
        .then(function () {
          return expect(app, 'to yield exchange', {
            request: {
              url: '/config.js'
            },
            response: {
              body: expect.it('to contain', 'depCache: {"lib/requireWorking.js":["./stringExport"]}')
            }
          });
        })
        .finally(stub.restore);
      });
    });

    describe('when not watching files', function () {
      it('should respond 304 when not modifying files', function () {
        var app = getApp({ watchFiles: false, bundle: true });

        return expect(app, 'to yield exchange', {
          request: {
            url: '/lib/noWatchMain.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200
          }
        })
        .then(function (context) {
          return expect(app, 'to yield exchange', {
            request: {
              url: '/lib/noWatchMain.js',
              headers: {
                accept: 'application/x-es-module */*',
                'If-None-Match': context.res.get('etag')
              }
            },
            response: 304
          });
        });
      });

      it('should respond 200 with fresh content when modifying main file', function () {
        var app = getApp({ watchFiles: false, bundle: true });
        var testFile = Path.resolve(Path.join(__dirname, '../fixtures/lib/noWatchMain.js'));
        var originalContent = fs.readFileSync(testFile, 'utf8');

        return expect(app, 'to yield exchange', {
          request: {
            url: '/lib/noWatchMain.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            body: expect.it('to contain', 'var b = \'bar\';')
          }
        })
        .then(function (context) {
          return new Promise(function (resolve, reject) {
            fs.writeFile(testFile, originalContent.replace('bar', 'baz'), 'utf8', function (error) {
              if (error) {
                return reject(error);
              } else {
                return resolve(context);
              }
            });
          });
        })
        .then(function (context) {
          return expect(app, 'to yield exchange', {
            request: {
              url: '/lib/noWatchMain.js',
              headers: {
                accept: 'application/x-es-module */*',
                'If-None-Match': context.res.get('etag')
              }
            },
            response: {
              statusCode: 200,
              body: expect.it('to contain', 'var b = \'baz\';')
            }
          });
        })
        .finally(function () {
          return fs.writeFileSync(testFile, originalContent);
        });
      });

      it('should respond 200 with fresh content when modifying dependency', function () {
        var app = getApp({ watchFiles: false, bundle: true });
        var testFile = Path.resolve(Path.join(__dirname, '../fixtures/lib/noWatchDependency.js'));
        var originalContent = fs.readFileSync(testFile, 'utf8');

        return expect(app, 'to yield exchange', {
          request: {
            url: '/lib/noWatchMain.js',
            headers: {
              accept: 'application/x-es-module */*'
            }
          },
          response: {
            statusCode: 200,
            body: expect.it('to contain', 'hello world')
          }
        })
        .then(function (context) {
          return new Promise(function (resolve, reject) {
            fs.writeFile(testFile, originalContent.replace('hello', 'goodbye'), 'utf8', function (error) {
              if (error) {
                return reject(error);
              } else {
                return resolve(context);
              }
            });
          });
        })
        .then(function (context) {
          return expect(app, 'to yield exchange', {
            request: {
              url: '/lib/noWatchMain.js',
              headers: {
                accept: 'application/x-es-module */*',
                'If-None-Match': context.res.get('etag')
              }
            },
            response: {
              statusCode: 200,
              body: expect.it('to contain', 'goodbye world')
            }
          });
        })
        .finally(function () {
          return fs.writeFileSync(testFile, originalContent);
        });
      });
    });
  });
}

runtests(getJspmApp, 'with Jspm module installed');
runtests(getBuilderApp, 'with systemjs-builder installed');
