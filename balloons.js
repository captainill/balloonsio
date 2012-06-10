
/*
 * Module dependencies
 */

var express = require('express')
    sio = require('socket.io'),
    easyoauth = require('easy-oauth'),
    redis = require('redis'),
    RedisStore = require('connect-redis')(express),
    utils = require('./utils'),
    config = require('./config'),
    fs = require('fs'),
    url = require("url");


/*
 * Instantiate redis
 */

var client;

console.log("process.env.REDISTOGO_URL= ", process.env.REDISTOGO_URL);
if (process.env.REDISTOGO_URL) {
  var rtg   = require("url").parse(process.env.REDISTOGO_URL);
  console.log('port info = ', rtg.port, rtg.hostname);
  client = redis.createClient(rtg.port, rtg.hostname);
  console.log(rtg.auth.split(":")[1]);
  client.auth(rtg.auth.split(":")[1]);
} else {
 client = redis.createClient();
}

/*
 * Clean all forgoten sockets in Redis.io
 */

// Delete all users sockets from their lists
client.keys('users:*:sockets', function(err, keys) {
  if(keys.length) client.del(keys);
  console.log('Deletion of sockets reference for each user >> ', err || "Done!");
});

// No one is online when starting up
client.keys('rooms:*:online', function(err, keys) {
  if(keys.length) client.del(keys);
  console.log('Deletion of online users from rooms >> ', err || "Done!");
});

// Delete all socket.io's sockets data from Redis
client.smembers('socketio:sockets', function(err, sockets) {
  if(sockets.length) client.del(sockets);
  console.log('Deletion of socket.io stored sockets data >> ', err || "Done!");
});


/*
 * Create 'chats' dir
 */
fs.mkdir('chats');


/*
 * Create and config server
 */

var app = express.createServer();

app.configure(function() {
  app.set('view engine', 'jade'); 
  app.set('views', __dirname + '/views/themes/' + config.config.theme.name);
  app.use(express.static(__dirname + '/public'));
  app.use(express.bodyParser());
  app.use(express.cookieParser());
  app.use(easyoauth(config.config.auth));
  app.use(app.router);
});


/*
 * Routes
 */

app.get('/', function(req, res, next) {
  req.authenticate(['oauth'], function(error, authenticated) { 
    if(authenticated) {
      client.hmset('users:' + req.getAuthDetails().user.username, req.getAuthDetails().user);
      res.redirect('/rooms/list');
    } else {
      res.render('index');
    } 
  });
});

app.get('/rooms/list', utils.restrict, function(req, res) {
  client.smembers('balloons:public:rooms', function(err, rooms) {
    res.locals({
      rooms: rooms
    });
    res.render('room_list');
  });
});

app.post('/create', utils.restrict, function(req, res) {
  if(req.body.room_name.length <= 30) {
    client.hgetall('rooms:' + req.body.room_name + ':info', function(err, room) {
      if(room && Object.keys(room).length) {
        res.redirect( '/rooms/' + room.name );

      } else {
        var room = {
          name: encodeURIComponent(req.body.room_name),
          admin: req.getAuthDetails().user.username,
          locked: 0
        };

        client.hmset('rooms:' + req.body.room_name + ':info', room, function(err, id) {
          if(!err) {
            client.sadd('balloons:public:rooms', req.body.room_name);
            res.redirect('/rooms/' + encodeURIComponent(req.body.room_name));
          }
        });
      }
    });
  } else {
    res.redirect('back');
  }
});

app.get('/rooms/:id', utils.restrict, function(req, res) {
  client.hgetall('rooms:' + req.params.id + ':info', function(err, room) {
    if(Object.keys(room).length) {
      client.smembers('rooms:' + req.params.id + ':online', function(err, online_users) {
        var users = [];

        online_users.forEach(function(username, index) {
          client.get('users:' + username + ':status', function(err, status) {
            users.push({
              username: username,
              status: status || 'available'
            });
          });
        });

        client.smembers("balloons:public:rooms", function(err, rooms) {
          client.get('users:' + req.getAuthDetails().user.username + ':status', function(err, user_status) {
            res.locals({
              rooms: rooms,
              room_name: room.name,
              room_id: req.params.id,
              username: req.getAuthDetails().user.username,
              user_status: user_status || 'available',
              users_list: users
            });

            res.render('room');
          })
        });
      });
    } else {
      res.redirect('back');
    }
  });
});


/*
 * Socket.io
 */

var io = sio.listen(app);

io.configure(function() {
  io.set('store', new sio.RedisStore);
  io.enable('browser client minification');
  io.enable('browser client gzip');
});


io.sockets.on('connection', function (socket) {
  var chatlogFileName
    , chatlogWriteStream;

  socket.on('set nickname', function(data) {
    var nickname = data.nickname
       , room_id = data.room_id
       , now = new Date();

    socket.join(room_id);

    // Chat Log handler
    chatlogFileName = 'chats/' + room_id + (now.getFullYear()) + (now.getMonth() + 1) + (now.getDate()) + ".txt"
    chatlogWriteStream = fs.createWriteStream(chatlogFileName, {'flags': 'a'});

    socket.set('nickname', nickname, function () {
      socket.set('room_id', room_id, function () {

        client.sadd('users:' + nickname + ':sockets', socket.id, function(err, socketAdded) {
          if(socketAdded) {

            client.sadd('socketio:sockets', socket.id);

            client.sadd('rooms:' + room_id + ':online', nickname, function(err, userAdded) {
              if(userAdded) {
                client.get('users:' + nickname + ':status', function(err, status) {
                  socket.emit('ready');
                  io.sockets.in(data.room_id).emit('new user', {
                    nickname: nickname,
                    status: status || 'available'
                  });
                });
              }
            });
          }
        });
      });
    });
  });

  socket.on('my msg', function(data) {
    socket.get('nickname', function(err, nickname) {
      socket.get('room_id', function(err, room_id) {  
        var no_empty = data.msg.replace("\n","");
        if(no_empty.length > 0) {
          var chatlogRegistry = {
            type: 'message',
            from: nickname,
            atTime: new Date(),
            withData: data.msg
          }

          chatlogWriteStream.write(JSON.stringify(chatlogRegistry) + "\n");
          
          io.sockets.in(room_id).emit('new msg', {
            nickname: nickname,
            msg: data.msg
          });        
        }   
      });
    });
  });

  socket.on('set status', function(data) {
    var status = data.status;

    socket.get('nickname', function(err, nickname) {
      client.set('users:' + nickname + ':status', status, function(err, statusSet) {
        io.sockets.emit('user-info update', {
          username: nickname,
          status: status
        });
      });
    });
  });

  socket.on('history request', function() {
    var history = [];
    var tail = require('child_process').spawn('tail', ['-n', 5, chatlogFileName]);
    tail.stdout.on('data', function (data) {
      var lines = data.toString('utf-8').split("\n");
      
      lines.forEach(function(line, index) {
        if(line.length) {
          var historyLine = JSON.parse(line);
          history.push(historyLine);
        }
      });

      socket.emit('history response', {
        history: history
      });
    });
  });

  socket.on('disconnect', function() {
    socket.get('room_id', function(err, room_id) {
      socket.get('nickname', function(err, nickname) {
        // 'sockets:at:' + room_id + ':for:' + nickname
        client.srem('users:' + nickname + ':sockets', socket.id, function(err, removed) {
          if(removed) {
            client.srem('socketio:sockets', socket.id);

            client.scard('users:' + nickname + ':sockets', function(err, members_no) {
              if(!members_no) {
                client.srem('rooms:' + room_id + ':online', nickname, function(err, removed) {
                  if (removed) {
                    chatlogWriteStream.destroySoon();
                    io.sockets.in(room_id).emit('user leave', {
                      nickname: nickname
                    });
                  }
                });
              }
            });
          }
        });
      });
    });
  });
});


app.listen(process.env.PORT || config.config.app.port);

console.log('Balloons.io started at port %d', app.address().port);
