var lob = require('lob-enc');
var util = require('util')
var events = require('events');
var countListeners = events.EventEmitter.listenerCount;

util.inherits(Pipe, events.EventEmitter)

var uids = 0;
function Pipe(type, keepalive)
{
  this.type = type;
  this.isPipe = true;
  this.uid = uids++;
  this.cloaked = false;

  if(keepalive)
    this.keepalive(keepalive);
}

Pipe.prototype.keepalive = function Pipe_keepalive(timeout)
{
  clearInterval(this.timer);
  if(typeof timeout === 'number'){
    this.timer = setInterval(function keepalive_interval(pipe){
      if (!pipe.emit('keepalive'))
        clearInterval(pipe.timer);
    }, timeout, this);
  }
}

Pipe.prototype.send = function Pipe_send()
{
  this.keepalive();
  this.sentAt = Date.now();
  if(!countListeners(this,'send'))
    return console.log('internal error, no pipe.onSend',this);
  // automatically add cloaking
  if(this.cloaked && lob.isPacket(arguments[0]))
    arguments[0] = lob.cloak(arguments[0]);

  //this.onSend.apply(this,arguments);

  this.emit('send',this,arguments);
}


module.exports.Pipe = Pipe;
