
var lob = require('lob-enc');
var ChannelStream = require("./stream.class.js")

// implements https://github.com/telehash/telehash.org/blob/v3/v3/channels/stream.md
exports.name = 'stream';

exports.mesh = function(mesh, cbExt)
{
  var ext = {open:{}};

  // incoming stream requests go here
  mesh.stream = function(onStream)
  {
    mesh.log.debug('adding onStream handler',typeof onStream);
    ext.onStream = onStream;
  }

  // takes any channel and returns a Duplex stream, oneshot is thtp style (one packet/channel)
  mesh.streamize = function(chan, encoding)
  {
    return new ChannelStream(chan, encoding);
  }

  // new incoming stream open request
  ext.open.stream = function(args, open, cbOpen){
    var link = this;
    if(typeof ext.onStream != 'function') return cbOpen('no stream');
    // pass any attached request packet as options, and a method to accept
    ext.onStream(link, lob.decode(open.body), function accept(err){
      if(err) return cbOpen(err);
      var channel = link.x.channel(open);
      channel.receive(open); // actually opens it
      return mesh.streamize(channel);
    });
  }

  ext.link = function(link, cbLink)
  {
    // create a new stream to this link
    link.stream = function(packet, encoding)
    {
      var open = {json:{type:'stream'},body:packet};
      open.json.seq = 1; // always reliable
      var channel = link.x.channel(open);
      var stream = mesh.streamize(channel, encoding);
      channel.send(open);
      return stream;
    }

    cbLink();
  }

  cbExt(undefined, ext);
}
