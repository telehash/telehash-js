#!/usr/bin/env node

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .describe('nick', 'nickname')
  .argv;

var fs = require('fs');
var path = require('path-extra');
var readline = require('readline');
var telehash = require('..');

// localize our id file
argv.id = (argv.id) ? path.resolve(argv.id) : path.join(path.homedir(),'.chat.json');

if(argv.v)
{
  telehash.log({debug:console.log});
  console.log('starting with args',argv);
}

telehash.load(argv, function(err, mesh){
  if(err) console.error('something went wrong :(',err,argv);
  if(!mesh) process.exit(1);
  
  if(!argv.nick) argv.nick = mesh.hashname.substr(0,8);
  
  mesh.router(true);
  mesh.discover(true);
  mesh.accept = mesh.link; // auto-link any

  // create a chat
  var args = argv._[0] || {}; // from given uri, or blank for new one
  mesh.chat(args, argv.nick, function(err, chat){
    if(err) console.error(err);
    if(!chat) process.exit(1);

    var rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.setPrompt(argv.nick+'> ');
    rl.on('close', function () {
      console.log(); // nice newline
      process.exit(0);
    });

    // clear readline then log
    function rlog()
    {
      process.stdout.clearLine();
      process.stdout.cursorTo(0);
      console.log.apply(console, arguments);
      rl.prompt();
    }

    if(!argv._[0]) rlog('invite others with',mesh.uri('chat:///?id='+chat.id));
    rl.prompt();

    rl.on('line', function(cmd){
      // no command so we just print list of connected
      if(cmd == '')
      {
        var list = Object.keys(chat.profiles).map(function(hn){return chat.profiles[hn].json.text});
        if(list.length == 0) list.push('nobody');
        rlog('present:',list.join(', '));
        return;
      }

      // send any raw text out to the chat
      chat.outbox.write(cmd);
      rl.prompt();
    });

    // process incoming messages
    chat.inbox.on('data',function(msg){
      // profile message is a join request, auto-accept
      if(msg.json.type == 'profile')
      {
        chat.join(mesh.link(msg.from));
      }

      if(msg.json.type == 'connect') rlog(chat.profiles[msg.from].json.text,'connected');
      if(msg.json.type == 'disconnect') rlog(chat.profiles[msg.from].json.text,'disconnected');
      
      if(msg.from == mesh.hashname) return; // ignore our own messages
      if(msg.json.type == 'chat') rlog(chat.profiles[msg.from].json.text+': '+msg.json.text);
    });
  });
  
});
