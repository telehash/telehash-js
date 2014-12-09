var lob = require('lob-enc');

// simple multi-eventing pipe base pattern with optional timer
// TODO convert this to an EventEmitter, it grew into a clone!
var uids = 0;
exports.Pipe = function(type, keepalive)
{
  var pipe = this;
  pipe.type = type;
  pipe.isPipe = true;
  pipe.uid = uids++;
  pipe.cloaked = false;

  pipe.keepalive = function(timeout)
  {
    if(typeof timeout == 'number') pipe.timeout = timeout;
    if(pipe.timer) clearTimeout(pipe.timer);
    pipe.timer = false;
    if(!pipe.timeout) return;
    pipe.timer = setTimeout(function(){
      // only run again if someone is listening
      if(pipe.emit('keepalive')) pipe.keepalive();
    }, pipe.timeout);
  }
  if(keepalive) pipe.keepalive(keepalive);

  pipe.send = function()
  {
    pipe.keepalive();
    pipe.sentAt = Date.now();
    if(typeof pipe.onSend != 'function') return console.log('internal error, no pipe.onSend',pipe);
    // automatically add cloaking
    if(pipe.cloaked && lob.isPacket(arguments[0])) arguments[0] = lob.cloak(arguments[0]);
    pipe.onSend.apply(pipe,arguments);
  }

  pipe.ons = {};
  pipe.on = function(on, cb)
  {
    if(!pipe.ons[on]) pipe.ons[on] = [];
    if(pipe.ons[on].indexOf(cb) == -1) this.ons[on].push(cb);
  }

  pipe.emit = function(on)
  {
    if(!pipe.ons[on]) return;
    var args = arguments;
    // run them all, and remove unless they say to keep
    var ret = false;
    pipe.ons[on].forEach(function(cb){
      var keep = cb.apply(pipe,args);
      if(!keep) pipe.ons[on].splice(pipe.ons[on].indexOf(cb),1);
      if(keep) ret = true;
    });
    return ret;
  }
  return pipe;
}