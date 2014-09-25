var Duplex = require('stream').Duplex;
var lob = require('lob-enc');

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
  
  // takes any channel and returns a Duplex stream
  mesh.streamize = function(chan)
  {
    if(typeof chan != 'object' || !chan.isChannel)
    {
      mesh.log.warn('invalid channel passed to streamize');
      return false;
    }

    var stream = new Duplex();
    stream.on('finish',function(){
      chan.send({json:{end:true}});
    });

    stream.on('error',function(err){
      chan.send({json:{err:err}});
    });

    stream._write = function(data,enc,cbWrite)
    {
      if(chan.state == 'gone') return cbWrite('closed');
      // chunk it
      while(data.length)
      {
        var chunk = data.slice(0,1000);
        data = data.slice(1000);
        var packet = {body:chunk};
        // last packet gets continuation callback
        if(!data.length)
        {
          packet.callback = cbWrite;
          if(stream.ended) packet.json = {end:true};
        }
        chan.send(packet);
      }
    }

    // convenience to end with optional data
    stream.end = function(data)
    {
      stream.ended = true;
      if(!data) data = new Buffer(0);
      stream.write(data);
    }

    // handle backpressure flag from the pipe.push()
    var more = false;
    stream._read = function(size){
      if(more) more();
      more = false;
    };

    chan.receiving = function(err, packet, cbMore) {
      // was a wait writing, let it through
      if(packet.body.length) if(!stream.push(packet.body)) more = cbMore;
      if(err) return stream.emit('error',err);
      if(packet.json.end) stream.push(null);
      if(!more) cbMore();
    }

    return stream;
  }

  // new incoming stream open request
  ext.open.stream = function(args, open, cbOpen){
    var link = this;
    if(typeof ext.onStream != 'function') return cbOpen('no stream');
    // pass any attached request packet as options, and a method to accept
    ext.onStream(link, lob.decode(open.body), function accept(err){
      if(err) return cbOpen(err);
      return mesh.streamize(link.x.channel(open));
    });
  }
  
  ext.link = function(link, cbLink)
  {
    // create a new stream to this link
    link.stream = function(packet)
    {
      var open = {json:{type:'stream'},body:packet};
      open.json.seq = 0; // always reliable
      var channel = link.x.channel(open);
      var stream = mesh.streamize(channel);
      channel.send(open);
      return stream;
    }

    cbLink();
  }
  
  cbExt(undefined, ext);
}
