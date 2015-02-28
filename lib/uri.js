var urllib = require('url');
var hashname = require('hashname');
var crypto = require('crypto');

// safe consistency
function parse(arg)
{
  try{
    var url = urllib.parse(arg, true);
  }catch(E){
    return false;
  }

  // paths is always an array
  if(!url.query.paths) url.query.paths = [];
  if(!Array.isArray(url.query.paths)) url.query.paths = [url.query.paths];
  
  // parse any paths
  url.paths = [];
  url.query.paths.forEach(function(epath){
    try{
      var path = JSON.parse(hashname.base32.decode(epath));
      if(typeof path == 'object' && typeof path.type == 'string') url.paths.push(path);
    }catch(E){};
  });

  // parse any csid keys
  url.keys = {};
  Object.keys(url.query).forEach(function(id){
    if(id.length != 4 || id.substr(0,2) != 'cs') return;
    url.keys[id.substr(2)] = url.query[id];
  });
  
  // parse any fragment
  if(url.hash) url.fragment = hashname.base32.decode(url.hash.substr(1));
  
  // add formatting wrapper
  url.encode = function()
  {
    // delete these to force lib to make new
    delete url.search;
    delete url.href;
    if(url.query.paths.length == 0) delete url.query.paths; // dumb node bug
    return urllib.format(url);
  }
  
  return url;
}

// decodes any query string keys, paths, and custom fragment data
exports.decode = function(uri)
{
  
  uri = parse(uri);
  if(!uri) return false;

  // insert generated paths from the hostname
  var port = parseInt(uri.port) || 42424;
  if(uri.hostname)
  {
    uri.paths.push({type:'udp4',ip:uri.hostname,port:port});
    uri.paths.push({type:'tcp4',ip:uri.hostname,port:port});
    uri.paths.push({type:'http',http:'http://'+uri.hostname+':'+port});
  }

  return uri;
}

exports.keys = function(base, keys)
{
  base = parse(base);
  if(!base || !keys) return false;

  Object.keys(keys).forEach(function(id){
    var val = keys[id];
    if(Buffer.isBuffer(val)) val = hashname.base32.encode(val);
    base.query['cs'+id] = val;
  });

  return base.encode();
}

exports.paths = function(base, paths)
{
  base = parse(base);
  if(!base || !Array.isArray(paths)) return false;

  paths.forEach(function(path){
    base.query.paths.push(hashname.base32.encode(JSON.stringify(path)));
  });

  return base.encode();
}

// embed valid fragment
exports.fragment = function(base, hn, custom)
{
  base = parse(base);
  if(!base || !hn) return false;
  if(!custom) custom = crypto.randomBytes(8);
  base.hash = '#'+hashname.base32.encode(Buffer.concat([custom,hashname.siphash(hn, custom)]));
  return base.encode();
}

// checks the fragment is from this hashname
exports.check = function(uri, hn)
{
  uri = parse(uri);
  if(!uri) return false;
  if(!uri.fragment || uri.fragment.length < 16) return false;
  var digest = hashname.siphash(hn, uri.fragment.slice(0,uri.fragment.length-8));
  if(digest.toString('hex') != uri.fragment.slice(uri.fragment.length-8).toString('hex')) return false;
  return true;
}

// attempts to discover keys via webfinger, dns, and https
exports.discover = function(url, cbDone)
{
  // TODO
  cbDone('not supported');
}