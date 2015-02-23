var crypto = require('crypto');
var streamlib = require('stream');

// implements https://github.com/telehash/telehash.org/blob/master/v3/channels/chat.md
exports.name = 'chat';

exports.mesh = function(mesh, cbMesh)
{
  var lib = mesh.lib;
  var self = {open:{}, chats:{}};

  // overwrite-able callback for invites
  var cbInvite = false;
  mesh.invited = function(handler){ cbInvite = handler; };
  
  // create/join a new chat
  mesh.chat = function(args, profile, cbReady)
  {
    // javascript is lame
    if(typeof profile == 'function')
    {
      cbReady = profile;
      profile = false;
    }
    if(!profile)
    {
      profile = args;
      args = {};
    }
    if(!cbReady) cbReady = function(err){ mesh.log.debug('chat error',err); };

    // accept uri arg
    if(typeof args == 'string')
    {
      var leader = mesh.link(args);
      if(!leader || !leader.args.token) return cbReady('bad uri: '+args);
      args = {leader:leader,id:leader.args.token};
    }
    if(typeof args != 'object') return cbReady('bad args');

    // generate or load basics for the unique chat id
    var chat = {};
    chat.secret = args.secret || crypto.randomBytes(8);
    chat.depth = args.depth || 1000;
    chat.seq = args.seq || chat.depth;
    chat.id = args.id || stamp();
    self.chats[chat.id] = chat;

    chat.leader = args.leader || mesh;
    chat.leading = (chat.leader == mesh) ? true : false;
    chat.messages = {}; // index of all cached chat messages "id":{...}
    chat.log = []; // ordered combined history ["id","id"]
    chat.profiles = {}; // profiles by hashname
    chat.last = {}; // last message id by hashname
    chat.invited = {}; // ACL
    chat.inviting = {}; // one at a time
    chat.inbox = new streamlib.Readable({objectMode:true});
    chat.inbox._read = function(){}; // all evented
    chat.outbox = new streamlib.Writable({objectMode:true});
    chat.streams = {}; // by hashname
    
    // sanitize our profile
    if(typeof profile == 'string') profile = {json:{text:profile}}; // convenient
    if(!profile.json) profile = {json:profile}; // friendly to make a packet
    chat.profile = profile;
    profile.json.type = 'profile';
    profile.json.id = (chat.leading) ? chat.id : stamp();
    chat.profiles[mesh.hashname] = profile;
    chat.last[mesh.hashname] = profile.json.id;

    // internal fail handler
    function fail(err, cbErr)
    {
      if(!err) return; // only catch errors
      mesh.log.warn('chat fail',err);
      chat.err = err;
      // TODO error inbox/outbox
      if(typeof cbErr == 'function') cbErr(err);
      if(cbReady) cbReady(err);
      cbReady = false;
    }

    // internal message id generator
    function stamp()
    {
      if(!chat.seq) return fail('chat history overflow, please restart');
      var id = lib.sip.hash(mesh.hashname, chat.secret);
      for(var i = 0; i < chat.seq; i++) id = lib.sip.hash(id.key,id);
      chat.seq--;
      return lib.base32.encode(id);
    }

    // internal to cache and event a message
    chat.receive = function(link, msg)
    {
      msg.from = link.hashname;

      // massage join
      if(msg.json.type == 'join')
      {
        msg.join = lib.lob.decode(msg.body);
        msg.json.join = msg.join.json; // convenience
      }

      // put in our caches/log
      if(msg.json.type == 'chat' || msg.json.type == 'join')
      {
        chat.messages[msg.json.id] = msg;
      // TODO put ordered in chat.log
        chat.log.unshift(msg);
      }
      mesh.log.debug('receiving message',msg.from,msg.json);
      chat.inbox.push(msg);
    }

    // this channel is ready
    chat.connect = function(link, channel)
    {
      mesh.log.debug('chat connected',link.hashname);
      // TODO disconnect old streams?
      var stream = chat.streams[link.hashname] = mesh.streamize(channel, 'lob');
      stream.on('data', function(msg){
        // TODO validate id!
        if(!msg.json.id) return mesh.log.debug('bad message',msg.json);
        chat.receive(link, msg);
      });
      stream.on('end', function(){
        mesh.log.debug('chat stream ended',link.hashname);
        if(chat.streams[link.hashname] == stream) delete chat.streams[link.hashname];
      });

      // signal good startup
      if(cbReady)
      {
        cbReady(undefined, chat);
        cbReady = false;
      }
    }

    chat.join = function(link, profile)
    {
      chat.invited[link.hashname] = true;

      // if we don't have their profile yet, send a join
      if(!chat.profiles[link.hashname])
      {
        var open = {json:{type:'profile',chat:chat.id,seq:1}};
        if(profile) open.json.profile = profile;
        var channel = link.x.channel(open);
        channel.send(open);
        var stream = mesh.streamize(channel,'lob');
        stream.write(chat.profile);
        stream.on('error', function(err){
          if(link == chat.leader) fail(err);
        });
        stream.on('finish',function(){
          if(chat.profiles[link.hashname]) chat.join(link);
        });
        stream.end();
        return;
      }
      
      // already connected
      if(chat.streams[link.hashname]) return;

      // let's get chatting
      var open = {json:{type:'chat',chat:chat.id,seq:1}};
      open.json.last = chat.last[link.hashname];
      var chan = link.x.channel(open);
      chan.send(open);
      chat.connect(link, chan);

    }

    // outgoing helper
    chat.send = function(msg)
    {
      if(typeof msg == 'string') msg = {json:{text:msg}}; // convenient
      if(!msg.json) msg = {json:msg}; // friendly to make a packet
      if(!msg.json.type) msg.json.type = 'chat';
      if(!msg.json.id) msg.json.id = stamp();
      if(!msg.json.at) msg.json.at = Math.floor(Date.now()/1000);
      if(!msg.json.after && chat.log[0]) msg.json.after = chat.log[0].json.id;
      msg = lib.lob.packet(msg.json,msg.body); // consistency

      // we receive it first
      chat.receive(mesh, msg);

      // deliver to anyone connected
      Object.keys(chat.streams).forEach(function(to){
        mesh.log.debug('sending to',to,msg.json.id);
        chat.streams[to].write(msg);
      });
    }
    
    // read messages from stream too
    chat.outbox._write = function(data, enc, cbDone){
      chat.send(data);
      cbDone();
    };
  
    // if not the leader, send our profile to them to start
    if(!chat.leading)
    {
      chat.join(chat.leader);
    }else{
      cbReady(undefined, chat);
      cbReady = false;
    }

    return chat;
  }


  self.open.profile = function(args, open, cbOpen){
    var link = this;

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    // accept and stream until the profile
    var chan = link.x.channel(open);
    var stream = mesh.streamize(chan, 'lob');
    if(!stream) return cbOpen('invalid open');

    // wait for the profile message
    stream.on('data', function(profile){

      if(profile.json.type != 'profile' || !profile.json.id) return cbOpen('bad profile');

      mesh.log.debug('join request',open.json,profile.json);
      stream.end(); // send all done

      // process invites for unknown chats
      var chat = self.chats[open.json.chat];
      if(!chat)
      {
        if(open.json.chat != profile.json.id) return cbOpen('unknown chat');
        if(!cbInvite) return cbOpen('cannot accept invites');

        // send the invite request to the app
        cbInvite(link, profile);
        return;
      }
      
      // if they're the leader, accept their profile
      if(chat.leader == link)
      {
        // see if they need our profile yet
        if(!open.json.profile) chat.join(link, profile.json.id);

        chat.profiles[link.hashname] = profile;
        chat.last[link.hashname] = profile.json.id;

        // this will now connect
        if(open.json.profile) chat.join(link);

        return;
      }

      // not invited is request to join
      if(!chat.invited[link.hashname])
      {
        // event the profile for the app to decide on
        chat.receive(link, profile);
        return;
      }

      // see if they need our profile yet
      if(!open.json.profile) chat.join(link, profile.json.id);

      // add new profile
      if(!chat.profiles[link.hashname])
      {
        chat.profiles[link.hashname] = profile;
        chat.last[link.hashname] = profile.json.id;
        var join = {json:{type:'join',from:link.hashname},body:lib.lob.encode(profile)};
        chat.send(join);
      }

      // if they have ours, this will get connected now
      if(open.json.profile) chat.join(link);

    });

    // process stream start
    chan.receive(open);

  }

  self.open.chat = function(args, open, cbOpen){
    var link = this;

    mesh.log.debug('chat request',open.json);

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    var chat = self.chats[open.json.chat];
    if(!chat) return cbOpen('unknown chat');
    if(!chat.profiles[link.hashname]) return cbOpen('no profile');
//    if(!chat.messages[open.json.last]) return cbOpen('unknown last');

    var chan = link.x.channel(open);
    chan.receive(open);
    chat.connect(link, chan);

  }

  cbMesh(undefined, self);

}