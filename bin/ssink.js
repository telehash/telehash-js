#!/usr/bin/env node

var repl = require('../lib/repl.js');
var hashname = require('hashname');

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .argv;

// a source hashname can be given as the first arg
var source = argv._[0];
if(source && !hashname.isHashname(source))
{
  console.log('invalid source, must be a hashname');
  process.exit(1);
}

function ss(stream)
{
  stream.pipe(process.stdout);
}

argv.norepl = true;
repl.start(argv, function(mesh){

  if(source)
  {
    // receive from a specific source
    var link = mesh.link(source);
    link.status(function(err){
      if(err) return console.log(err);
      ss(link.stream());
    });
  }else{
    // accept any incoming
    console.error('ssource',mesh.hashname);
    mesh.stream(function(link, req, accept){
      console.error('connected',link.hashname);
      ss(accept());
    });
  }
});

