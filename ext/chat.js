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
    chat.invited = {}; // ACL
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

    // internal fail handler
    function fail(err, cbErr)
    {
      if(!err) return; // only catch errors
      mesh.log.warn('chat fail',err);
      chat.err = err;
      // TODO error inbox/outbox
      if(cbErr) cbErr(err);
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
    chat.connected = function(link, channel)
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
        mesh.log.info('chat stream ended',link.hashname);
        if(connected[link.hashname] == stream) delete connected[link.hashname];
      });

    }

    chat.join = function(link, cbDone)
    {
      function done(err){
        if(err) mesh.log.debug('join error',err);
        if(cbDone) cbDone(err, chat);
        cbDone = false;
      }

      chat.invited[link.hashname] = true;
      // only when online
      mesh.link(link.hashname, function(err, link){
        if(err || !link.up) return done('offline'); // must be online
      
        // TODO, start join or chat channel?

        // minimum chat packet
        var json = {join:chat.joined.json.id, last:chat.last[mesh.hashname]};

        // check if there's a waiting open to respond to
        if(chat.connecting[hashname])
        {
          mesh.log.debug('responding to cached open',chat.connecting[hashname]);
          var packet = chat.connecting[hashname];
          delete chat.connecting[hashname];
          chat.last[hashname] = packet.json.last;
          var channel = link.x.channel(packet);
          channel.receive(packet); // for reliability
          channel.send({json:json});
          chat.connected(link, channel, done);
          return;
        }
      
        // already online
        if(connected[hashname]) return;
      
        // start a new outgoing chat channel
        json.type = 'chat';
        json.seq = 1; // always reliable
        json.chat = chat.id;
        var channel = link.x.channel({json:json});
        
        // process first response before making connected
        channel.receiving = function(err, packet, cbMore) {
          if(err) return done(err);
          if(!packet.json.join || !packet.json.last) return done('bad chat response');
          if(chat.profiles[hashname] == '*') chat.profiles[hashname] = packet.json.join;
          if(chat.profiles[hashname] != packet.json.join) return done('bad chat join');
          chat.last[hashname] = packet.json.last;
          chat.connected(link, channel, done);
          cbMore();
        };

        mesh.log.debug('sending chat',json);
        channel.send({json:json});
      });

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
      Object.keys(connected).forEach(function(to){
        mesh.log.debug('sending to',to,msg.json.id);
        connected[to].write(msg);
      });
    }
    
    // read messages from stream too
    chat.outbox._write = function(data, enc, cbDone){
      chat.send(data);
      cbDone();
    };
  
    // if not the leader, send our profile to them to start
    if(!chat.leading) chat.join(chat.leader, cbReady);
    else cbReady(undefined, chat);

    return chat;
  }


  self.open.join = function(args, open, cbOpen){
    var link = this;

    // ensure valid request
    var id = lib.base32.decode(open.json.join);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    // accept and stream until the profile
    var chan = link.x.channel(open);
    var stream = mesh.streamize(chan, 'lob');
    if(!stream) return cbOpen('invalid open');

    // wait for the profile message
    stream.on('data', function(profile){

      if(profile.json.type != 'profile' || !profile.json.id) return cbOpen('bad profile');

      // process invites for unknown chats
      var chat = self.chats[open.json.join];
      if(!chat)
      {
        if(open.json.join != profile.json.id) return cbOpen('unknown chat');
        if(!cbInvite) return cbOpen('cannot accept invites');

        // send the invite request to the app
        cbInvite(link, profile);
        return;
      }
      
      mesh.log.info('JOIN REQUEST',open.json,profile.json);
      
      // if they're the leader, accept their profile
      if(chat.leader == link)
      {
        chat.profiles[link.hashname] = profile;

        // see if they need our profile yet, otherwise get connected
        if(!open.json.last) chat.join(link);
        else chat.connect(link);
        return;
      }

      // not invited is request to join
      if(!chat.invited[link.hashname])
      {
        // event the profile for the app to decide on
        chat.receive(link, profile);
        return;
      }

      // add new profile
      if(!chat.profiles[link.hashname])
      {
        chat.profiles[link.hashname] = profile;
        var join = {json:{type:'join',from:link.hashname},body:lib.lob.encode(profile)};
        chat.send(join);
      }

      // see if they need our profile yet, otherwise get connected
      if(!open.json.last) chat.join(link);
      else chat.connect(link);

    });

    // process stream start
    chan.receive(open);

  }

  self.open.chat = function(args, open, cbOpen){
    var link = this;

    mesh.log.info('CHAT REQUEST',open.json);

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    var chat = self.chats[open.json.chat];
    if(!chat) return cbOpen('unknown chat');
    if(!chat.profiles[link.hashname]) return cbOpen('no profile');
    if(!chat.messages[open.json.last]) return cbOpen('unknown last');

    var chan = link.x.channel(open);
    chan.receive(open);
    chat.connected(link, chan);

  }

  cbMesh(undefined, self);

}