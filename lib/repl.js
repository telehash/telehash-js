var fs = require('fs');
var path = require('path-extra');
var repl = require('repl');
var telehash = require('..');

// a common backend to start a REPL for different utility commands
exports.start = function(argv)
{
  if(argv.port == 42420)
  {
    console.log('that port is reserved');
    process.exit(1);
  }

  // get the general name for the command
  var name = argv.name || path.basename(process.argv[1]).replace(path.extname(process.argv[1]),'');

  // localize our id file
  argv.id = (argv.id) ? path.resolve(argv.id) : path.join(path.homedir(),'.'+name+'.json');
  argv.links = (argv.links) ? path.resolve(argv.links) : path.join(path.homedir(),'.links.json');

  if(argv.v)
  {
    telehash.log({debug:console.log});
    console.log('router starting with args',argv);
  }

  telehash.load(argv, function(err, mesh){
    mesh.json().router = true;
    mesh.discover(true);
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
}