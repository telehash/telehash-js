#!/usr/bin/env node

exports = {}; // testing

var telehash = require('../node.js');
var fs = require('fs');
var path = require('path-extra');

exports.router = function(args, cbRouter)
{
  args.router = true;
  telehash.load(args, function(err, mesh){
    if(mesh)
    {
      mesh.log.info(mesh.json);
      mesh.log.info('router up');
    }
    cbRouter(err, mesh);
  });
}

// if loading as a module, don't do script stuff
if(module.parent) return;

// we're a script, take args and start
var argv = require('optimist')
  .default('port', 42424)
  .boolean('v').describe('v', 'verbose')
  .argv;

if(argv.port == 42420)
{
  console.log('that port is reserved');
  process.exit(1);
}

// localize our id file
argv.id = (argv.id) ? path.resolve(argv.id) : path.join(path.homedir(),'.router.json');
argv.links = (argv.links) ? path.resolve(argv.links) : path.join(path.homedir(),'.links.json');

if(argv.v)
{
  telehash.log({debug:console.log});
  console.log('router starting with args',argv);
}

exports.router(argv, function(err){
  if(!err) return;
  console.log('something went wrong :(',err,argv);
  process.exit(1);
});

