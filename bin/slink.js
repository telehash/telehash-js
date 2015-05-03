#!/usr/bin/env node

// another testing utility to spawn a process and link to it over STDIN/STDOUT

var telehash = require('../lib/mesh.js');
var lob = require('lob-enc');

function error(err)
{
  console.error(err);
  process.exit(1);
}

telehash.log({debug:console.log});

telehash.generate(function(err, id){
  if(err) return error(err);
  telehash.mesh({id:id}, function(err, mesh){
    if(err) return error(err);

    mesh.accept = function(from)
    {
      console.log("GOT ACCEPT",from.hashname);
      var link = mesh.link(from);
      link.status(function(err){
        if(err) return error(err);
        setTimeout(function(){process.exit(0)},100);
      });
      setTimeout(function(){error('timeout')},2000);
    }

    // create a pipe to a spawn'd process
    var cmd = process.argv[2] || error('need command to spawn');
    var child = require('child_process').spawn(cmd);
    child.stderr.pipe(process.stderr);

    pipe = new telehash.Pipe('child');
    pipe.id = cmd;
    pipe.path = {'type':'serial'};
    pipe.chunks = lob.chunking({size:64, blocking:true}, function receive(err, packet){
      if(err || !packet)
      {
        mesh.log.error('pipe chunk read error',err,pipe.id);
        return;
      }
      // handle incoming greeting as a discovery
      if(packet.head.length > 1)
      {
        var greeting = packet.json;
        greeting.pipe = pipe;
        mesh.discovered(greeting);
      }else{
        mesh.receive(packet, pipe);
      }
    });
    child.stdout.pipe(pipe.chunks);
    pipe.chunks.pipe(child.stdin);
    pipe.onSend = function(packet, link, cb){
      pipe.chunks.send(packet);
      cb();
    }

  });
});



