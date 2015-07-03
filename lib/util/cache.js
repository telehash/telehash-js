module.exports = {
  route : new routeCache()
}

// when routing, we need to keep a 1-min cache to dedup any circular routes
var dedup = {};
setInterval(function dedupt(){dedup={}},60*1000);

function route(){
  this._routes = {};
  return this;
}

route.prototype.insert = function route_insert(packet){
  var tok = crypto.createHash('sha256').update(packet).digest('hex');
  var routes = this._routes
  setTimeout(function(){
    delete routes[tok]
  },60 * 1000)
  if (routes[tok])
    return false;
  else
    return (routes[tok] = true);
}
