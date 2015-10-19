var crypto = require("crypto")
module.exports = route;

function route(){
  var self = this;
  this._routes = {};
  return function(packet){
    return self.insert(packet)
  };
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
