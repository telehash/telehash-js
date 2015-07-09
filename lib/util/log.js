//default logging functions;

var debug = require('debug');

function DebugObject(label){
  if (!(this instanceof DebugObject))
    return new DebugObject(label)
  var debugg = debug(label);
  this._debug = function(msg){
    debugg(msg)
  }
  return this;
}


DebugObject.prototype.info  = function(msg){
  console.log(msg)
};

DebugObject.prototype.error = function(msg){
  console.error(msg)
};

DebugObject.prototype.warn = function(msg){
  console.trace(msg)
};

DebugObject.prototype.debug = function(msg){
  if (!this._debug)
    return console.log(msg)
  this._debug(msg)
}

module.exports = function(label){
  return new DebugObject(label)
};
