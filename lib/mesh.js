var crypto = require('crypto');
var e3x = require('e3x');
var hashname = require('hashname');
var base32 = hashname.base32;
var lob = require('lob-enc');
var stringify = require('json-stable-stringify');
var Pipe = require('./pipe.class');
var urilib = require('./uri');
var Mesh = require('./mesh.class');

// export some of these to the whole package for apps to use directly as telehash.*
exports.e3x = e3x;
exports.hashname = hashname;
exports.base32 = base32;
exports.lob = lob;
exports.Pipe = Pipe;
exports.uri = urilib;

// activity/debugging logging utilities
var log = {
  error:function(){console.error.apply(console,arguments);},
  warn:function(){console.warn.apply(console,arguments);},
  debug:function(){},
  info:function(){console.log.apply(console,arguments);}
}
// override/set any logging level
exports.log = function(args)
{
  if(typeof args == 'object') Object.keys(args).forEach(function(type){
    log[type] = args[type];
  });
  return log;
}

exports._log = log;

// keep track of all default extensions
exports.extensions = [];
exports.add = function(ext)
{
  log.debug('adding extension',ext&&ext.name);
  if(!ext || typeof ext.name != 'string') return false;
  exports.extensions[ext.name] = ext;
  return true;
}

// add the default extensions
exports.add(require('../ext/peer'));
exports.add(require('../ext/path'));
exports.add(require('../ext/stream'));
exports.add(require('../ext/thtp'));
exports.add(require('../ext/chat'));

// generate new local id
exports.generate = function(cb)
{
  log.debug('generating secrets');
  e3x.generate(function(err,pairs){
    if(err)
    {
      log.debug('e3x gen failed',err);
      return cb(err);
    }
    var id = {keys:{},secrets:{}};
    Object.keys(pairs).forEach(function(csid){
      id.keys[csid] = base32.encode(pairs[csid].key);
      id.secrets[csid] = base32.encode(pairs[csid].secret);
    });
    id.hashname = hashname.fromKeys(id.keys);
    log.info('generated new id',id.hashname);
    cb(undefined,id);
  });
}

exports.mesh = function(args, cbMesh){
   return (new Mesh(args, cbMesh, exports));
}
