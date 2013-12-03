#!/usr/bin/env node

var fs = require("fs");
var path = require("path");
var tele = require("../index");
var argv = require("optimist")
  .usage("Usage: $0 --id id.json --seeds seeds.json")
  .default("id", "./id.json")
  .argv;

// write all debug output to a log
var vlog = fs.createWriteStream(path.join(__dirname,"debug.log"), {flags:"a"});
vlog.write("starting with "+JSON.stringify(argv)+"\n");
tele.debug(function(){
  var args = arguments;
  args = Object.keys(arguments).map(function(k){return args[k]});
  args.unshift(new Date().toISOString());
  vlog.write(args.join(" ")+"\n");
});

// set up our readline interface
rl = require("readline").createInterface(process.stdin, process.stdout, null);
function log(line){
  // hacks!
  rl.output.write("\x1b[2K\r");
  console.log(line);
  rl._refreshLine()
}

// load or generate our crypto id
var id;
var idfile = path.join(__dirname, argv.id);
if(fs.existsSync(idfile))
{
  id = require(idfile);
  init();
}else{
  tele.genkey(function(err, key){
    if(err) return cmds.quit(err);
    id = key;
    rl.question('nickname? ', function(nick) {
      id.nick = nick;
      fs.writeFileSync(idfile, JSON.stringify(id, null, 4));
      init();
    });    
  });
}

var groups = {
  ids:{},
  get:function(id){
    if(groups.ids[id]) return groups.ids[id];
    var group = groups.ids[id] = {id:id,members:{}};
    group.add = function(chan){ chan.group = group; };
  }
};
var members = {};// TODO finish converting
var chat;
function init()
{
  rl.setPrompt(id.nick+"> ");
  rl.prompt();

  chat = tele.hashname(id);
  if(argv.seeds) chat.addSeeds(argv.seeds);

  chat.online(function(err){
    log((err?err:"online as "+chat.hashname));
    if(err) process.exit(0);
  });

  chat.listen("chat", function(err, arg, chan, cb){
    if(arg.js.group) groups.get(arg.js.group).add(chan);
    handshake(false, arg, chan, cb);
    chan.send({js:{nick:id.nick}});
  });
  chat.listen("members", function(err, arg, chan, cb){
    // send members in chunks
    cb();
    var group = groups.get(arg.js.group);
    var mlist = Object.keys(group.members);
    mlist.push(chat.hashname);
    while(mlist.length > 0)
    {
      var chunk = mlist.slice(0, 10);
      mlist = mlist.slice(10);
      chan.send({js:{members:chunk}});
      if(mlist.length == 0) chan.end();
    }
  });
}

function memberMesh(err, arg, chan, cb)
{
  if(err && err !== true) return log("error fetching members: "+err);
  if(Array.isArray(arg.js.members)) arg.js.members.forEach(function(member){
    if(members[member]) return;
    if(member == chat.hashname) return;
    var hn = chat.whois(member);
    if(hn) hn.start("chat", {js:{nick:id.nick, room:room}}, handshake);
  });
  cb();
}

// intitial incoming or answer to outgoing chats
var nicks = {};
function handshake(err, arg, chan, cb)
{
  if(err) return console.log("handshake err",err);
  chan.nick = (arg.js.nick) ? arg.js.nick : chan.hashname.substr(0,6);
  nicks[chan.nick] = chan.hashname;
  if(!members[chan.hashname]) log(chan.nick+" joined");
  members[chan.hashname] = chan;
  chan.callback = function(err, arg, chan, cbMessage){
    if(arg && arg.js.message) log("["+chan.nick+"] "+arg.js.message);
    if(err)
    {
      var msg = (err !== true)?" ("+err+")":"";
      log(chan.nick+" left"+msg);
      delete members[chan.hashname];
    }
    cbMessage();
  };
  cb();
}

function blast(msg)
{
  Object.keys(members).forEach(function(member){
    members[member].send({js:{"message":msg}});
  });
}

// our chat handler
rl.on('line', function(line) {
  if(line.indexOf("/") == 0) {
    var parts = line.split(" ");
    var cmd = parts.shift().substr(1);
    if(cmds[cmd]) cmds[cmd](parts.join(" "));
    else log("I don't know how to "+cmd);
  }else if(line != "") blast(line);
  rl.prompt();
});

var cmds = {};
cmds.nick = function(nick){
  id.nick = nick;
  blast(false, nick);
  rl.setPrompt(id.nick+"> ");
  rl.prompt();
}
cmds.quit = function(err){
  log(err||"poof");
  process.exit();
}
cmds.whoami = function(){
  log(room+"@"+chat.hashname);
}
cmds.who = cmds.whois = function(arg){
  if(!arg) return Object.keys(members).forEach(cmds.who);
  if(nicks[arg]) log(arg+" is "+nicks[arg]);
  if(members[arg]) log(arg+" is "+members[arg].nick);
}
cmds["42"] = function(){
  log("I hash, therefore I am.");
}
cmds.join = function(arg)
{
  var parts = arg.split("@");
  var host = chat.whois(parts[1]);
  if(!host) return log("invalid id to join");
  host.start("members", {js:{group:parts[0]}}, memberMesh);
}
