// simple multi-eventing pipe base pattern with optional timer
exports.Pipe = function(type, keepalive)
{
  var pipe = this;
  pipe.type = type;
  if(keepalive)
  {
    // start send timer, fires pipe.do('keepalive')
  }
  pipe.send = function(packet)
  {
    // timer
    if(typeof this.onSend == 'function') this.onSend(packet);
  }
  pipe.ons = {};
  pipe.on = function(on, cb)
  {
    if(!pipe.ons[on]) pipe.ons[on] = [];
    if(pipe.ons[on].indexOf(cb) == -1) this.ons[on].push(cb);
  }
  pipe.do = function(on)
  {
    if(!pipe.ons[on]) return;
    var args = arguments;
    // run them all, and remove unless they say to keep
    pipe.ons[on].forEach(function(cb){
      var keep = cb.apply(pipe,args);
      if(!keep) pipe.ons[on].splice(pipe.ons[on].indexOf(cb),1);
    })
  }
  return pipe;
}