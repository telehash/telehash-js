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
  if(cmd == '')
  {
    var list = Object.keys(chat.nicks).map(function(hn){return chat.nicks[hn]});
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
  mesh.chat(args, function(err, ref){
    console.log("CHATNEW",err,typeof ref)
    chat = ref;
    if(err) mesh.rlog('err',err);
    if(!chat) process.exit(1);

    // automatically join the chat
    chat.join(argv.nick, function(err){
      if(err) return mesh.rlog('error',err);
      if(argv._[0]) mesh.rlog('connected');
      else mesh.rlog('invite others with',mesh.uri({protocol:'chat',token:chat.id}));
    });
    
    // process incoming messages
    chat.nicks = {};
    chat.inbox.on('data',function(msg){
      if(msg.from == mesh.hashname) return; // ignore our own
      console.log('MSG',JSON.stringify(msg.json));
      if(msg.json.type == 'request')
      {
        mesh.rlog('accepting',msg.json.text,msg.from);
        chat.add(msg.from);
      }
      if(msg.json.type == 'join')
      {
        chat.nicks[msg.from] = msg.json.text;
        mesh.rlog(chat.nicks[msg.from],'just joined');
      }
      if(msg.json.type == 'chat') mesh.rlog(chat.nicks[msg.from]+': '+msg.json.text);
    });
  });

});