var crypto = require('crypto');
var stream = require('stream');

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
  mesh.chat = function(args, cbReady)
  {
    if(typeof args == 'function' && !cbReady)
    {
      cbReady = args;
      args = {};
    }
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
    chat.messages = {}; // index of all cached chat messages "id":{...}
    chat.log = []; // ordered combined history ["id","id"]
    chat.roster = {}; // joins by hashname
    chat.last = {}; // lasts by hashname
    chat.joined = false;
    chat.inbox = new stream.Readable();
    chat.outbox = new stream.Writable();
    chat.connecting = {}; // incoming opens
    
    // in scope only
    var connected = {}; // by hashname, channels

    // load more history on demand, tries to get 'back' number from every participant
    chat.history = function(back, cbDone){
      
    };

    // serve the thtp requests for this chat
    chat.base = '/chat/'+chat.id+'/';
    mesh.match(chat.base,function(req,res){
      var parts = req.url.split('/');
      if(parts[3] == 'roster') return res.end(JSON.stringify(chat.roster));
      if(parts[3] == 'id' && chat.log[parts[4]]) return res.end(self.pencode(chat.log[parts[4]]));
      res.writeHead(404).end();
    });

    function fail(err, cbErr)
    {
      if(!err) return; // only catch errors
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

    chat.join = function(join, cbDone)
    {
      if(!cbDone) cbDone = function(err){ if(err) mesh.log.debug(err); };
      if(!join) return cbDone('requires join message');
      if(typeof join == 'string') join = {json:{text:join}}; // convenient
      if(!join.json) join = {json:join}; // friendly to make a packet
      chat.seq = chat.depth;
      chat.joined = join;
      join.json.type = 'join';
      join.json.id = (chat.leader == mesh) ? chat.id : stamp();
      chat.roster[mesh.hashname] = chat.last[mesh.hashname] = join.json.id;
      join.json.at = Math.floor(Date.now()/1000);
      if(chat.log[0]) join.json.after = chat.log[0].id;
      
      // tries to sync first if we're not the leader
      chat.sync(cbDone);
    }

    chat.sync = function(cbDone)
    {
      // leader is always in sync
      if(chat.leader == mesh) return cbDone(undefined, chat);

      // non-leaders always fetch updated roster to sync
      var parts = [];
      chat.leader.request(chat.base+'roster', function(err, res){
        if(err) return cbDone(err);
        res.on('data',function(data){ parts.push(data);}).on('end',function(){
          var body = Buffer.concat(parts);
          try{
            chat.roster = JSON.parse(body.toString());
          }catch(E){
            return fail(E.toString(), cbDone);
          }
          
          // create a queue of required message ids to sync
          var queue = [chat.id];
          Object.keys(chat.roster).forEach(function(hn){
            chat.add(hn); // check/try connection
            if(chat.roster[hn] != '*') queue.push(chat.roster[hn]);
          });
        
          // perform the queue before being done w/ the sync
          // TODO
          cbDone(undefined, chat);
        });
      });
    }

    chat.add = function(hashname, cbDone){
      if(!cbDone) cbDone = function(err){ if(err) mesh.log.debug(err); };
      if(typeof hashname == 'object') hashname = hashname.hashname; // allow passing a link obj
      if(!lib.hashname.isHashname(hashname)) return cbDone('invalid hashname'); // sanity check
      if(!chat.roster[hashname] && chat.leader != mesh) return cbDone('not the leader'); // only leaders can add new
      if(!chat.roster[hashname]) chat.roster[hashname] = '*'; // allow in master roster
      if(!chat.joined) return cbDone('not joined'); // must be joined
      if(connected[hashname]) return cbDone(undefined, chat.roster[hashname]); // already online
      mesh.link(hashname, function(err, link){
        if(err || !link.up) return cbDone('offline'); // must be online
      
        // minimum chat packet
        var json = {join:chat.joined.json.id, last:chat.last[mesh.hashname]};

        // check if there's a waiting open to respond to
        if(chat.connecting[hashname])
        {
          mesh.log.debug('responding to cached open',chat.connecting[hashname]);
          var channel = link.x.channel(chat.connecting[hashname]);
          delete chat.connecting[hashname];
          channel.send({json:json});
          var stream = connected[hashname] = mesh.streamize(channel, 'lob');
          // TODO
          return;
        }
      
        // start a new outgoing chat channel
        json.type = 'chat';
        json.seq = 1; // always reliable
        json.chat = chat.id;
        var channel = link.x.channel({json:json});
        
        // process first response before making connected
        channel.receiving = function(err, packet, cbMore) {
          if(err) return cbDone(err);
          if(!packet.json.join || !packet.json.last) return cbDone('bad chat response');
          if(chat.roster[hashname] == '*') chat.roster[hashname] = packet.json.join;
          if(chat.roster[hashname] != packet.json.join) return cbDone('bad chat join');
          chat.last[hashname] = packet.json.last;
          var stream = connected[hashname] = mesh.streamize(channel, 'lob');
          // TODO stream.pipe()
          // TODO get/cache join id
          cbMore();
          cbDone(undefined, packet.json.join);
        };

        mesh.log.debug('sending chat',json);
        channel.send({json:json});
      });

    }

    chat.send = function(msg)
    {
      if(!msg.json.type) msg.json.type = 'chat';
      if(!msg.json.id) msg.json.id = stamp();
      var packet = lib.lob.packet(msg.json,msg.body);

      if(msg.json.type == 'chat')
      {
        chat.log[msg.json.id] = packet;
        chat.last[mesh.hashname] = msg.json.id; // our last id
      }

      // deliver to anyone connected
      Object.keys(connected).forEach(function(to){
        connected[to].write(packet);
      });
    }
  
    chat.sync(cbReady);
    return chat;
  }


  self.open.chat = function(args, open, cbOpen){
    var link = this;

    // ensure valid request
    var id = lib.base32.decode(open.json.chat);
    if(!id || id.length != 8) return cbOpen('invalid chat id');
    
    // process invites
    var chat = self.chats[open.json.chat];
    if(!chat)
    {
      if(open.json.chat != open.json.join) return cbOpen('unknown chat');
      if(!cbInvite) return cbOpen('cannot accept invites');
      // create to load roster then call invited
      mesh.log.debug('CHAT INVITE',open.json);
      mesh.chat({leader:link,id:open.json.chat},function(err, chat){
        if(err) return cbOpen(err);
        chat.connecting[link.hashname] = open;
        cbInvite(chat);
      });
      return;
    }

    mesh.log.debug('CHAT REQUEST',open.json,chat);

    if(packet.json.chat != chat.id) return mesh.log.warn('bad chat id',packet);
    if(!packet.json.join || !packet.json.last) return mesh.log.warn('bad chat response',packet);
    if(chat.roster[hashname] == '*') chat.roster[hashname] = packet.json.join;
    if(chat.roster[hashname] != packet.json.join) return mesh.log.warn('bad chat join',packet);

    // is sender in the roster?
    // TODO respond, make channel, add connected

  }

  cbMesh(undefined, self);

}