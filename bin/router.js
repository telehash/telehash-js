#!/usr/bin/env node

exports = {}; // testing

var telehash = require('..');
var fs = require('fs');
var path = require('path-extra');
var repl = require('repl');

// do any generic router specialization on a basic mesh
exports.router = function(args, cbRouter)
{
  args.router = true;
  telehash.load(args, function(err, mesh){
    cbRouter(err, mesh);
  });
}

// if loading as a module, don't do script stuff
if(module.parent) return;

// we're a script, take args and start
var argv = require('optimist')
  .default('port', 42424)
  .boolean('norepl').describe('norepl', 'disable REPL')
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

exports.router(argv, function(err, mesh){
  if(err)
  {
    console.log('something went wrong :(',err,argv);
    return process.exit(1);
  }
  mesh.log.info(mesh.json({space:2}));
  mesh.log.info('router up');
  if(argv.norepl !== false) return;
  var r = repl.start({
    prompt: mesh.hashname.substr(0,8)+'> ',
    input: process.stdin,
    output: process.stdout
  });
  r.context.mesh = mesh;
  r.on('exit', function () {
    // TODO any nice shutdown?
    console.log(); // nice newline
    process.exit(0);
  });
});

