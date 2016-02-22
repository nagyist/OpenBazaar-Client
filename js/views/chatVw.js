var Backbone = require('backbone'),
  $ = require('jquery'),
  loadTemplate = require('../utils/loadTemplate'),
  app = require('../App.js').getApp(),
  ChatConversationsCl = require('../collections/chatConversationsCl'),
  ChatMessagesCl = require('../collections/chatMessagesCl'),
  baseVw = require('./baseVw'),
  ChatHeadsVw = require('./chatHeadsVw'),
  ChatConversationVw = require('./chatConversationVw');

module.exports = baseVw.extend({
  events: {
    'click .js-chatOpen': 'slideOut',
    'click .js-closeChat': 'close',
  },

  initialize: function(options) {
    var options = options || {};

    if (!options.model) {
      throw new Error('Please provide a model of the logged-in user.');
    }

    if (!options.socketView) {
      throw new Error('Please provide a socketView instance.');
    }    

    this.socketView = options.socketView;

    // cache some selectors which are outside of
    // our el's scope
    this.$sideBar = $('#sideBar');
    this.$container = $('.container');
    this.$obContainer = $('#obContainer');
    this.$loadingSpinner = $('.spinner-with-logo');

    this.chatConversationsCl = new ChatConversationsCl();
    this.chatConversationsCl.fetch();

    this.listenTo(this.chatConversationsCl, 'sync', (cl) => {
      if (cl.length) {
        for (var i=0; i < 100; i++) {
          cl.add(
            cl.at(0).clone().set('guid', '----------> ' + i)
          );
        }
      }

      if (!this.chatHeadsVw) {
        this.chatHeadsVw = new ChatHeadsVw({
          collection: cl
        });

        this.$chatHeadsContainer.html(
          this.chatHeadsVw.render().el
        );

        this.listenTo(this.chatHeadsVw, 'chatHeadClick', this.onChatHeadClick)
        this.registerChild(this.chatHeadsVw);
      } else {
        this.chatHeadsVw.render();
      }
    });

    this.listenTo(window.obEventBus, 'socketMessageReceived', (response) => {
      this.handleSocketMessage(response);
    });    
  },

  onChatHeadClick: function(vw) {
    this.openConversation(vw.model);
  },

  openConversation: function(model) {
    // Model is the model of the user you want to converse with.
    // When calling this function from inside our view, we are passing
    // in a chatConversation model, but passing in a profile model should probably
    // work as well (at least now it does). The latter could be useful when
    // calling this function from outside of this view.

    var msgCl = new ChatMessagesCl();

    this.slideOut();

    if (this.chatConversationVw) {
      // if we were already chatting with this person and that
      // conversation is just hidden, show it
      if (this.chatConversationVw.model.get('guid') === model.get('guid')) {
        this.$convoContainer.removeClass('chatConversationContainerHide');
        return;
      } else {
        this.chatConversationVw.remove();
      }
    }    

    msgCl.comparator = 'timestamp';

    this.chatConversationVw = new ChatConversationVw({
      model: model,
      user: this.model,
      collection: msgCl
    });

    this.registerChild(this.chatConversationVw);

    this.listenTo(this.chatConversationVw, 'close-click', this.closeConversation);
    
    this.listenTo(this.chatConversationVw, 'enter-message', function(msg) {
      var conversationMd;

      this.sendMessage(model.get('guid'), model.get('public_key'), msg);
      this.chatConversationVw.getMessageField().val('');

      // since messages sent by us won't come back via the socket,
      // to not have to call get_chat_messages to get the message
      // we just sent, we'll add it in manually
      this.chatConversationVw.collection.add({
        avatar_hash: this.model.avatar_hash,
        guid: this.model.guid,
        message: msg,
        outgoing: true,
        read: true,
        timestamp: Date.now()
      });

      // update chat head
      if (conversationMd = this.chatConversationsCl.findWhere({ guid: msg.sender })) {
        conversationMd.set({
          last_message: msg,
          unread: 0,
          timestamp: Date.now()
        });        
      } else {
        // todo: maybe manually create and add in the model, rather
        // than having to fetch
        this.chatConversationsCl.fetch();
      }
    });

    this.$('.chatConversationContainer').html(
      this.chatConversationVw.render().el
    ).removeClass('chatConversationContainerHide');    
  },

  sendMessage: function(recipient, key, msg) {
    var chatMessage = {
      request: {
        'api': 'v1',
        'id': Math.random().toString(36).slice(2),
        'command': 'send_message',
        'guid': recipient,
        'handle': '',
        'message': msg,
        'subject': '',
        'message_type': 'CHAT',
        'public_key': key
      }
    };

    this.socketView.sendMessage(JSON.stringify(chatMessage));
  },

  handleSocketMessage: function(response) {
    var msg = JSON.parse(response.data).message,
        openlyChatting = false,
        conversationMd;

    if (!msg) return;

    if (msg.message_type === 'CHAT') {
      // if we're actively chatting with the person who sent the message,
      // whether the view is hidden or not, update the conversation
      if (this.chatConversationVw && msg.sender === this.chatConversationVw.model.get('guid')) {
        if (this.isConvoOpen()) {
          openlyChatting = true;
        }

        // add in new message
        this.chatConversationVw.collection.add({
          avatar_hash: msg.avatar_hash,
          guid: msg.sender,
          message: msg.message,
          outgoing: false,
          read: true,
          timestamp: msg.timestamp
        });
      }

      // update chat head
      if (conversationMd = this.chatConversationsCl.findWhere({ guid: msg.sender })) {
        conversationMd.set({
          last_message: msg.message,
          unread: openlyChatting ? 0 : conversationMd.get('unread') + 1,
          timestamp: msg.timestamp,
          avatar_hash: msg.avatar_hash
        });
      } else {
        // todo: maybe manually create and add in the model, rather
        // than having to fetch
        this.chatConversationsCl.fetch();
      }

      if (!window.focused || !openlyChatting) {
        new Notification(msg.handle || msg.sender + ':', {
          body: msg.message,
          icon: avatar = msg.avatar_hash ? app.serverConfig.getServerBaseUrl() + '/get_image?hash=' + msg.avatar_hash +
            '&guid=' + msg.sender : '/imgs/defaultUser.png'
        });

        app.playNotificationSound();
      }
    }
  },

  isConvoOpen: function() {
    return !this.$convoContainer.hasClass('chatConversationContainerHide');
  },

  _______openChat: function(guid, key) {
    var self = this,
        model = this.options.model,
        avatarURL = "",
        avatarHash = window.localStorage.getItem("avatar_" + guid);

    if (this.currentChatId === guid) {
      this.openConversation();
      return;
    }

    this.currentChatId = guid;

    if (avatarHash !== '') {
      avatarURL = model.get('serverUrl') + "get_image?hash=" + avatarHash + "&guid=" + guid;
    }

    this.openConversation();

    $('.chatConversationAvatar').css('background-image', 'url(' + avatarURL + '), url(imgs/defaultUser.png)');
    $('.chatConversationLabel').html(guid);
    this.conversationKey = key;
    $('#inputConversationMessage').focus();

    this.updateChat(guid);
    this.closeConversationSettings();

    $('.chatHead').removeClass('chatHeadSelected');
    $('#chatHead_' + guid).parent().addClass('chatHeadSelected');

    // Mark as read
    $.post(self.serverUrl + "mark_chat_message_as_read", {guid: guid});
    $('#chatHead_' + guid).attr('data-count', 0);
    $('#chatHead_' + guid).removeClass('badge');
    $('#chatHead_' + guid).addClass('chatRead');

  },

  _______openConversation: function() {
    this.slideOut();
    this.$('.chatConversation').removeClass('chatConversationHidden');
    this.$('.chatConversationHeads').addClass('chatConversationHeadsCompressed textOpacity50');
    this.$('.chatSearch').addClass('textOpacity50');
  },

  closeConversation: function() {
    // this.$('.chatConversation').addClass('chatConversationHidden');
    // this.$('.chatConversationHeads').removeClass('chatConversationHeadsCompressed').removeClass('textOpacity50');
    // this.$('.chatHead').removeClass('chatHeadSelected');
    // this.$('.chatSearch').removeClass('textOpacity50');
    
    // this.chatConversationVw && this.chatConversationVw.remove();
    this.$convoContainer.addClass('chatConversationContainerHide');
  },

  slideOut: function() {
    this.$sideBar.addClass('sideBarSlid');
    this.$container.addClass('compressed');
    this.$loadingSpinner.addClass('modalCompressed');
    this.$obContainer.addClass('noScrollBar');
    $('#colorbox').addClass('marginLeftNeg115');
    self.$('.chatSearch').addClass('chatSearchOut');
    self.$('.btn-chatOpen')
        .addClass('hide')
        .find('span')
        .removeClass('hide');
    // self.$('.chatMessagesLabel').removeClass('hide');
  },

  slideIn: function() {
    this.$sideBar.removeClass('sideBarSlid');
    this.$container.removeClass('compressed');
    this.$loadingSpinner.removeClass('modalCompressed');
    this.$obContainer.removeClass('noScrollBar');
    $('#colorbox').removeClass('marginLeftNeg115');
    self.$('.chatSearch').removeClass('chatSearchOut');
  },

  close: function(){
    this.slideIn();
    this.$('.btn-chatOpen')
        .removeClass('hide')
        .find('span')
        .addClass('hide');

    // $('.chatHeadSelected').removeClass('chatHeadSelected');
    // this.closeConversation();
  },      

  render: function() {
    loadTemplate('./js/templates/chat.html', (tmpl) => {
      this.$el.html(tmpl());

      this.$chatHeadsContainer = this.$('.chatConversationHeads');
      this.$convoContainer = this.$('.chatConversationContainer');
    });

    return this;
  }
});