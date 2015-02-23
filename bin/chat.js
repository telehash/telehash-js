#!/usr/bin/env node

var repl = require('../lib/repl.js');

var argv = require('optimist')
  .boolean('v').describe('v', 'verbose')
  .describe('nick', 'nickname')
  .argv;

var chat;
argv.eval = function(cmd, context, filename, callback) {
  if(!chat) return callback(null, 'not connected');
  cmd = cmd.slice(1,cmd.length-1).trim(); // goop from REPL lib
  
  // no command so we just print list of connected
  if(cmd == '')
  {
    var list = Object.keys(chat.profiles).map(function(hn){return chat.profiles[hn].json.text});
    if(list.length == 0) list.push('nobody');
    callback(null, list.join(', '));
    return;
  }

  // send any raw text out to the chat
  chat.outbox.write(cmd);
  callback(null, 'sent');
}

repl.start(argv, function(mesh){
  mesh.router(true);
  mesh.discover(true);
  mesh.accept = mesh.link; // auto-link any

  // create a chat
  var args = argv._[0] || {}; // from given uri, or blank for new one
  mesh.chat(args, argv.nick, function(err, ref){
    chat = ref;
    if(err) mesh.rlog('err',err);
    if(!chat) process.exit(1);

    if(argv._[0]) mesh.rlog('connected');
    else mesh.rlog('invite others with',mesh.uri({protocol:'chat',token:chat.id}));
    
    // process incoming messages
    chat.nicks = {};
    chat.inbox.on('data',function(msg){
//      console.log('MSG',JSON.stringify(msg.json));
      var nick = (chat.profiles[msg.from]) ? chat.profiles[msg.from].json.text : 'unknown';
      if(msg.json.type == 'join')
      {
        mesh.rlog(nick,'just joined');
      }
      if(msg.json.type == 'profile')
      {
        mesh.rlog('accepting',msg.json.text,msg.from);
        chat.join(mesh.link(msg.from));
      }
      if(msg.from != mesh.hashname && msg.json.type == 'chat') mesh.rlog(nick+': '+msg.json.text);
    });
  });

});