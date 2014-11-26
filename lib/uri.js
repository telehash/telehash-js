var urllib = require('url');

// default a protocol:// if one not specified
exports.decode = function(encoded, protocol)
{
  if(typeof encoded != "string") return false;
  // default a protocol if none
  if(encoded.indexOf("://") == -1) encoded = (protocol||'link') + "://" + encoded;
  // enforce match if specified
  if(protocol && encoded.indexOf(protocol) != 0) return false;

  var url = urllib.parse(encoded, true);
  if(!url) return false;

  var uri = {};
  // TODO more validation
  uri.protocol = url.protocol.substr(0,url.protocol.length-1);
  uri.user = url.auth;
  uri.canonical = url.host;
  uri.address = url.hostname;
  uri.port = parseInt(url.port);
  if(url.pathname) uri.session = url.pathname.substr(1);
  uri.keys = url.query;
  if(url.hash) uri.token = url.hash.substr(1);
  
  // auto-gen some paths to try
  uri.paths = [];
  if(uri.port)
  {
    uri.paths.push({type:'udp4',ip:uri.address,port:uri.port});
    uri.paths.push({type:'tcp4',ip:uri.address,port:uri.port});
    uri.paths.push({type:'http',url:'http://'+uri.canonical});
  }
  return uri;
},

exports.encode = function(uri)
{
  var url = {slashes:true};
  url.protocol = uri.protocol || 'link';
  if(uri.user) url.auth = uri.user;
  url.hostname = uri.address || 'localhost';
  url.port = uri.port;
  url.pathname = uri.session || '/';
  url.query = uri.keys;
  url.hash = uri.token;
  return urllib.format(url);
}
