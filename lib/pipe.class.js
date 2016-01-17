var lob = require('lob-enc');
var util = require('util')
var log = require("./util/log")("Pipe")
var events = require('events');
var countListeners = events.EventEmitter.listenerCount;
var KEEPALIVE = null;

util.inherits(Pipe, events.EventEmitter)

var uids = 0;

/** A Pipe is a simple eventemmiter that bridges between telehash transports and {TLink}s
 * @class Pipe
 * @constructor
 * @param {string} type - 'udp4', 'tcp4', 'http-client' etc.
 * @param {number} keepalive - the amaount of time between keepalive events
 * @return {Pipe}
 */
function Pipe(type, keepalive)
{
  this.type = type;
  this.isPipe = true;
  this.uid = uids++;
  this.cloaked = false;

  if(keepalive || KEEPALIVE)
    this.keepalive(KEEPALIVE || keepalive);
  return this;
}

Pipe.keepalive = function PIPE_KEEPALIVE(timeout){
  KEEPALIVE = timeout;
}

/** Clear the previous keepalive interval and set a new one (or just clear it)
 * @param {number=} timeout - the interval
 * @fires Pipe#keepalive
 */

Pipe.prototype.keepalive = function Pipe_keepalive(timeout)
{
  clearInterval(this.timer);
  /**
   * keepalive event. used by Link to manage connectivity over multiple pipes
   *
   * @event Pipe#keepalive
   * @type {null}
   */
  if(typeof timeout === 'number'){
    this.timer = setInterval(function keepalive_interval(pipe){
      if (!pipe.emit('keepalive', pipe))
        clearInterval(pipe.timer);
    }, timeout, this);
  }
}


/** this triggers the send mechanism of the underlying transport.
 * @param {Buffer=} packet - handshake, open, or an ordinary packet...
 * @param {TLink=} link -
 * @param {function=} callback - called after the packet is sent
 * @fires Pipe#send
 */
Pipe.prototype.send = function Pipe_send()
{
  //this.keepalive();
  this.sentAt = Date.now();
  if(!countListeners(this,'send') && !this.onSend)
    return log.error('internal error, no pipe.onSend');
  // automatically add cloaking
  if(this.cloaked && lob.isPacket(arguments[0]))
    arguments[0] = lob.cloak(arguments[0]);

  if (!this.onSend)
    this.emit('send',this,arguments[0], arguments[1], arguments[2], arguments[3], arguments[4]);
  else
    this.onSend.apply(this, arguments)
}

//stub to be removed by implementations
Pipe.prototype.close = function Pipe_close(cb){
  if (this._close)
    this._close(cb)
  else{
    this.removeAllListeners()
    cb()
  }
}


module.exports = Pipe;
