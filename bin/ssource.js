#!/usr/bin/env node

var repl = require('../lib/repl.js');
var hashname = require('hashname');

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .argv;

// a target hashname can be given as the first arg
var sink = argv._[0];
if(sink && !hashname.isHashname(sink))
{
  console.log('invalid sink, must be a hashname');
  process.exit(1);
}

function ss(stream)
{
  process.stdin.pipe(stream);
  stream.on('end',process.exit);
}

argv.norepl = true;
repl.start(argv, function(mesh){

  if(sink)
  {
    // send to a specific target sink
    var link = mesh.link(sink);
    link.status(function(err){
      if(err) return console.log(err);
      ss(link.stream());
    });
  }else{
    // accept any incoming
    console.log('ssink',mesh.hashname);
    mesh.stream(function(link, req, accept){
      console.log('connected',link.hashname);
      ss(accept());
    });
  }
});

