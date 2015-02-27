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
      // TODO any nice shutdown?
      console.log(); // nice newline
      process.exit(0);
    });

    function rlog()
    {
      console.log.apply(console, arguments);
      rl.prompt();
    }

    if(argv._[0]) rlog('connected');
    else rlog('invite others with',mesh.uri({protocol:'chat',token:chat.id}));
    rl.prompt();

    rl.on('line', function(cmd){
      // no command so we just print list of connected
      if(cmd == '')
      {
        var list = Object.keys(chat.profiles).map(function(hn){return chat.profiles[hn].json.text});
        if(list.length == 0) list.push('nobody');
        rlog(list.join(', '));
        return;
      }
      rl.pause();
      // send any raw text out to the chat
      chat.outbox.write(cmd);
      setTimeout(function(){rlog('sent');},1000);    
    });

    
    // process incoming messages
    chat.nicks = {};
    chat.inbox.on('data',function(msg){
//      console.log('MSG',JSON.stringify(msg.json));
      var nick = (chat.profiles[msg.from]) ? chat.profiles[msg.from].json.text : 'unknown';
      if(msg.json.type == 'join')
      {
        rlog(nick,'just joined');
      }
      if(msg.json.type == 'profile')
      {
        rlog('accepting',msg.json.text,msg.from);
        chat.join(mesh.link(msg.from));
      }
      if(msg.from != mesh.hashname && msg.json.type == 'chat') rlog(nick+': '+msg.json.text);
    });
  });
  
});
