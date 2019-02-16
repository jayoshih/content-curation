/* CONSTANTS */
var ITEM_TYPES = ["content", "message"];
var MESSAGE_TYPES = ["activity", "instructions", "message", "prompt", "reflection"];

/* MODULES */
var Backbone = require("backbone");
var _ = require("underscore");
var BaseViews = require("edit_channel/views");
var Models = require("edit_channel/models");
var ImageUploader = require('edit_channel/image/views');
var UndoManager = require("backbone-undo");
require("summernote");
var dialog = require("edit_channel/utils/dialog");
const State = require("edit_channel/state");

var ExerciseViews = require('edit_channel/exercise_creation/views');
var RelatedViews = require('edit_channel/related/views');

/* PARSERS */
var toMarkdown = require('to-markdown');
var stringHelper = require("edit_channel/utils/string_helper");

/* STYLESHEETS */
require("../../../css/zip.css");
require("stories.less");
require("../../../css/summernote.css");

/* TRANSLATIONS */
var NAMESPACE = "storyEditor";
var MESSAGES = {};

var PROMPT_MAPPING = {
    "resource":"Add instructions or description of this resource.",
    "message": "Add a message for students letting them know anything else about this resource, narration to transition between resources if they’re viewing this story independently, your additional thoughts on what they just engaged with, or anything else. ",
    "instructions": "Add directions for an activity, instructions to take notes, logistical tasks to be done in managing materials offline, or anything else on what to do after students are finished engaging with this resource",
    "reflection": "Add questions, prompts, suggestions, or areas for discussion to encourage students to reflect on what they just engaged with, whether together or individually.",
    "activity": "Add text to guide students through an activity, exercise, project, or follow-up of any kind pertaining to what they just engaged with. Directions for take-home work or group discussions may go here as well."
}


var StoryImageUploadView = ImageUploader.ImageUploadView.extend({
    render: function() {
        this.$el.html(this.modal_template(null, {
            data: this.get_intl_data()
        }));
        $("body").append(this.el);
        this.$(".modal").modal({show: true});
        this.$(".modal").on("hide.bs.modal", this.close);
        this.$(".modal").on("shown.bs.modal", this.init_focus);
        _.defer(this.render_dropzone);
    }
});

var StoryUploadImage = function (context) {
    return $.summernote.ui.button({
        contents: '<i class="note-icon-picture"/>',
        tooltip: 'Image',
        click: function () {
            var view = new StoryImageUploadView({
                callback: context.options.callbacks.onImageUpload,
                preset_id: 'exercise_image'
            });
        }
    }).render();
}


/*********** TEXT EDITOR FOR QUESTIONS, ANSWERS, AND HINTS ***********/
var StoryEditorView = ExerciseViews.EditorView.extend({

    default_template: require("./hbtemplates/editor_default.handlebars"),
    toggle_loading: function(isLoading) {},
    activate_editor: function() {
        var self = this;
        var selector = this.cid + "_editor";
        this.$el.html(this.edit_template({selector: selector}, {
            data: this.get_intl_data()
        }));
        this.editor = new ExerciseViews.Summernote(this.$("#" + selector), this, {
            toolbar: [
                ['style', ['bold', 'italic']],
                ['insert', ['customupload', 'customformula']],
                ['controls', ['customundo', 'customredo']]
            ],
            buttons: {
                customupload: StoryUploadImage,
                customundo: ExerciseViews.UndoButton,
                customredo: ExerciseViews.RedoButton
            },
            placeholder: PROMPT_MAPPING[this.model.get("message_type")],
            disableResizeEditor: true,
            disableDragAndDrop: true,
            shortcuts: false,
            selector: this.cid,
            callbacks: {
                onChange: _.debounce(this.save, 1),
                onPaste: this.paste_content,
                onImageUpload: this.add_image,
                onKeydown: this.process_key,
                onUndo: this.undo,
                onRedo: this.redo,
                onInit : function(){
                    $('.note-editor .note-btn').each(function() {
                        $(this).attr("data-original-title", self.get_translation($(this).data("original-title")));
                    });
                }
            }
        });
        $('.dropdown-toggle').dropdown();
        this.editing = true;
        this.render_editor();
    },
    render_default() {
        this.$el.html(this.default_template({ text: PROMPT_MAPPING[this.model.get("message_type")] }, {
            data: this.get_intl_data()
        }));
    },
});


var StoryModalView = BaseViews.BaseModalView.extend({
    template: require("./hbtemplates/story_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,

    initialize: function(options) {
        _.bindAll(this, "selected");
        this.modal = true;
        this.selecting = options.selecting;
        this.onselect = options.onselect;
        this.parent_node = options.parent_node;
        this.render(this.close, {channel:State.current_channel.toJSON(), selecting: this.selecting});
        new StoryDisplayListView({
            el: this.$(".modal-body"),
            modal : this,
            model:options.channel,
            selecting: this.selecting,
            onselect: this.selected,
            parent_node: this.parent_node
        });
    },
    selected: function(collection) {
        this.onselect(collection);
        this.close();
    },
    close: function() {
        if(this.modal){
            this.$(".modal").modal('hide');
        }
        this.remove();
        $("body").removeClass("modal-open");
    }
});

var StoryDisplayListView = BaseViews.BaseEditableListView.extend({
    template: require("./hbtemplates/story_list.handlebars"),
    list_selector: ".story_list",
    default_item: ".default-item",
    name: NAMESPACE,
    $trs: MESSAGES,
    initialize: function(options) {
        this.bind_edit_functions();
        var self = this;
        this.selecting = options.selecting;
        this.onselect = options.onselect;
        this.parent_node = options.parent_node;
        this.collection = new Models.StoryCollection();
        this.collection.fetch_for_channel(this.model.id).then(function() {
            self.render();
        });
    },
    events: {
        'click #new_story_button' : 'new_story'
    },
    render: function() {
        this.$el.html(this.template({selecting: this.selecting}, {
            data: this.get_intl_data()
        }));
        this.load_content();
    },
    create_new_view:function(data){
        var newView = new StoryListItem({
            model: data,
            containing_list_view: this,
            selecting: this.selecting,
            onselect: this.onselect,
            parent_node: this.parent_node
        });
        this.views.push(newView);
        return newView;
    },
    new_story: function(){
        var data = {
            title: "New Story",
            channel: State.current_channel.id
        };
        var self = this;
        var story = new Models.StoryModel(data);
        story.save().then(function() {
            var newView = self.create_new_view(story);
            self.$(self.list_selector).append(newView.el);
            self.$(".default-item").css('display', 'none');
        });
    }
});

var StoryListItem = BaseViews.BaseListEditableItemView.extend({
    name: NAMESPACE,
    $trs: MESSAGES,
    tagName: "li",
    className:"story_item list-group-item row",
    template: require("./hbtemplates/story_list_item.handlebars"),
    initialize: function(options) {
        this.bind_edit_functions();
        this.selecting = options.selecting;
        this.onselect = options.onselect;
        this.parent_node = options.parent_node;
        _.bindAll(this, 'delete_story', 'zip_content');
        this.listenTo(this.model, "sync", this.render);
        this.render();
    },
    render: function() {
        this.$el.html(this.template({
            story: this.model.toJSON(),
            channel: State.current_channel.id,
            selecting: this.selecting
        }, {
            data: this.get_intl_data()
        }));
    },
    events: {
        'click .delete_story' : 'delete_story',
        "click .zip_button": "zip_content"
    },
    delete_story: function(event){
        var self = this;
        dialog.dialog("Warning", "Are you sure you want to delete this story?", {
            "CANCEL":function(){},
            "DELETE STORY": function(){
                self.model.destroy();
            },
        }, null);
        self.cancel_actions(event);
    },
    zip_content: function() {
        var self = this;
        this.display_load("Zipping story...", function(load_resolve, load_reject){
            self.model.zip_story(self.parent_node.id).then(function(collection) {
                self.onselect(collection);
                load_resolve(true);
            }).catch(load_reject);
        });
    }
});


var StoryView = ExerciseViews.ExerciseView.extend({
    template: require("./hbtemplates/story_edit.handlebars"),
    review_template: require("./hbtemplates/story_review_item.handlebars"),
    list_selector:"#story_list",
    default_item:"#story_list >.default-item",
    is_changed: false,
    additem_el: "#additem",
    last_item: null,
    get_next_order: function(){
        if(this.collection.length > 0){
            var max = this.collection.max(function(i){ return i.get('order');});
            return (max && max.get('order') >= 0)? max.get('order') + 1 : 1;
        }
        return 1;
    },

    initialize: function(options) {
        _.bindAll(this, 'add_item', 'selected_content_item');
        this.bind_edit_functions();
        this.page_count = 1;
        this.render();
    },
    events: {
        "click #addmessage": "add_message",
        "click #addinstructions": "add_instructions",
        "click #addreflection": "add_reflection",
        "click #addactivity": "add_activity",
        "click #save_story": "save_content",
        "click #zipper": "zip_content",
        "change .story_field": "set_story",
        "click #addcontentitem": "add_content_item",
        "click #addclipboarditem": "add_clipboard_item",
        "click #preview_story": "preview_story"
    },
    render: function() {
        this.$el.html(this.template({
            story: this.model.toJSON(),
            channel: State.current_channel.toJSON()
        }, {
            data: this.get_intl_data()
        }));

        var self = this;
        this.model.fetch_items().then(function(items) {
            self.collection = items;
            var filtered_collection = new Models.StoryItemCollection(self.collection.where({'is_supplementary': false}))
            self.load_content(filtered_collection);
            _.forEach(self.views, function(v) { v.render_actions(); })
        });
    },
    set_story: function() {
        this.model.set("title", this.$("#story_title").val().trim());
        this.model.set("description", this.$("#story_description").val().trim());
    },
    add_message: function() {
        this.add_item("message", "message");
    },
    add_instructions: function() {
        this.add_item("message", "instructions");
    },
    add_reflection: function() {
        this.add_item("message", "reflection");
    },
    add_activity: function() {
        this.add_item("message", "activity");
    },
    add_item: function(item_type, message_type, node, is_supplementary) {
        if(!this.$(this.additem_el).hasClass('disabled')){
            this.$(this.default_item).css('display', 'none');
            this.close_all_editors();

            var newItem = new Models.StoryItemModel({
                item_type: item_type,
                message_type: message_type,
                text: "",
                is_supplementary: is_supplementary,
                node_id: node && node.get("node_id"),
                order: this.get_next_order()
            });

            var self = this;
            newItem.save().then(function(story_item) {
                if (node) {
                    newItem.set("contentnode", node);
                }

                self.collection.add(newItem);
                if (self.last_item) {
                    self.last_item.add_action("NEXT", story_item.id);
                }
                var newView = self.create_new_view(newItem);
                $("#story_list").append(newView.el);
                self.propagate_changes();
                newView.set_open();
            });
        }
    },
    add_content_item: function() {
        var rootnode = State.current_channel.get_root("main_tree");
        this.content_modal = new StoryContentModalView({
            onselect: this.selected_content_item,
            model: rootnode,
        });
    },
    add_clipboard_item: function() {
        var clipboard = window.current_user.get_clipboard();
        this.content_modal = new StoryContentModalView({
            onselect: this.selected_content_item,
            model: clipboard
        });
    },
    selected_content_item: function(model) {
        var collection = new Models.ContentNodeCollection();
        var self = this;
        collection.fetch_nodes_by_ids_complete([model.id], true).then(function(collection) {
            var model = collection.at(0);
            self.add_item("content_node", "resource", model);
        });

        this.content_modal.close();
    },
    add_review: function(event) {
        var story_id = $(event.target).data('story-id');
        var page_title = $(event.target).data('page-number');
        this.last_item.add_action("Review " + page_title, story_id);
    },
    create_new_view:function(model){
        var new_story_item =  new StoryItemView({
            model: model,
            containing_list_view : this,
            onchange: this.onchange,
            page_count: this.page_count++,
        });
        this.views.push(new_story_item);
        if (!model.get("is_supplementary")) {
            this.last_item && this.last_item.render_actions();
            this.last_item = new_story_item;
        }
        return new_story_item;
    },
    onchange: function() {
        this.is_changed = true;
    },
    save_content: function() {
        this.collection.forEach(function(model) {
            model.set('story', window.story.id);
            model.set('id', model.id); // Ids not getting passed to serializer
        });
        this.collection.save();
        this.model.save().then(function() {
            window.location = "/channels/" + State.current_channel.id + "/edit";
        });
    },
    preview_story: function() {
        new StoryPreviewModalView({
            collection: this.collection,
            model: this.model
        });
    }
});

var StoryItemView = ExerciseViews.AssessmentItemView.extend({
    template: require("./hbtemplates/story_item_edit.handlebars"),
    pages_template: require("./hbtemplates/story_pages.handlebars"),
    closed_toolbar_template: require("./hbtemplates/toolbar_closed.handlebars"),
    open_toolbar_template: require("./hbtemplates/toolbar_open.handlebars"),
    editor_el: ".question",
    initialize: function(options) {
        _.bindAll(this, "set_toolbar_open", "toggle", "set_toolbar_closed", "commit_type_change",
                "set_undo_redo_listener", "unset_undo_redo_listener", "toggle_focus", "set_true_false", "add_supplementary",
                "toggle_undo_redo", "update_hints", "set_type", "set_open", "add_action", "select_supplementary");
        this.originalData = this.model.toJSON();
        this.onchange = options.onchange;
        this.page_count = options.page_count;
        this.question = this.model.get('question');
        this.containing_list_view = options.containing_list_view;
        this.node = this.model.get("contentnode");
        this.node = this.node && (this.node.attributes) ? this.node.toJSON() : this.node;
        this.init_undo_redo();
        this.render();
        this.set_toolbar_closed();
    },
    events: {
        "click .cancel": "cancel",
        "click .delete": "delete",
        "click .toggle_story": "toggle_focus",
        "click .toggle" : "toggle",
        "click .content_item": "load_preview",
        "click .add_review": "add_review",
        "click .add_supplementary": "add_supplementary",
        "click .go_to_page_link": "load_page_list",
        "click .page_select": "add_page"
    },
    render: function() {

        this.$el.html(this.template({
            model: this.model.toJSON(),
            cid: this.cid,
            node: this.node,
            page_count: this.page_count,
            thumbnail: this.node && _.find(this.node.files, function(i) { return i.preset.thumbnail; })
        }, {
            data: this.get_intl_data()
        }));
        this.create_popover();
        this.render_editor();
    },
    create_popover:function(){
        var self = this;
        this.$el.find(".go_to_page_link").popover({
            html: true,
            placement: "top",
            trigger: "focus",
            toggle: "popover",
            content: function () {
                return $(this.dataset.id).html();
            }
        });
    },
    load_page_list: function(){
        var pages = [];
        var self = this;
        _.forEach(this.containing_list_view.views, function(v) {
            if(v.model.id !== self.model.id) {
                pages.push({
                    "id": v.model.id,
                    "page": v.page_count,
                    "title": v.model.get("message_type")
                });
            }
        });
        this.$(".page_popover").html(this.pages_template({pages: pages}));
        this.$(".page_select").on("click", function(event) {
            var el = $(event.target);
            var name = (el.data('page') > self.page_count)? "Jump to " : "Review ";
            self.add_action(name + el.data('page-title'), el.data('id'));
            self.render_actions();
        });
    },
    render_editor: function(){
        if (!this.editor_view) {
            this.editor_view = new StoryEditorView({model: this.model, edit_key: "text"});
        }
        this.$(this.editor_el).html(this.editor_view.el);
    },
    validate: function() {
        return true;
    },
    toggle_loading: function(isLoading) {},
    set_open:function(){
        this.open = true;
        this.$(".assessment_item").addClass("active");
        this.editor_view.activate_editor();
        this.$(".question").removeClass("unfocused");
        this.set_toolbar_open();
        this.set_undo_redo_listener();
    },
    add_action: function(button_text, story_item_id) {
        var actions = JSON.parse(this.model.get('actions') || "{}");
        actions[story_item_id.toString()] = button_text;
        this.model.set("actions", JSON.stringify(actions));
    },
    render_actions: function() {
        var actions = JSON.parse(this.model.get('actions') || "{}");
        var self = this;
        self.$el.find(".linked-actions").html("");
        _.forEach(_.keys(actions), function(k) {
            var view = _.find(self.containing_list_view.views, function(v) {
                return v.model.id.toString() == k.toString();
            });
            var item = null;
            var title = "";
            if (view) {
                item = view.model;
                title = "Page " + view.page_count + " (" + item.get("message_type") + ")";
            } else {
                item = self.containing_list_view.collection.find(function(m) {
                    return m.id.toString() == k.toString();
                });
                title = (item.get("contentnode").attributes)? item.get("contentnode").get("title") : item.get("contentnode").title;
            }

            var new_action = new StoryActionView({
                action: {"title":title, "button": actions[k]},
                item: item,
                onedit: self.add_action
            });
            self.$el.find(".linked-actions").append(new_action.el);
        });
    },
    add_supplementary: function() {
        // Open file selector, don't render supplementary on tree
        var rootnode = State.current_channel.get_root("main_tree");
        this.content_modal = new StoryContentModalView({
            onselect: this.select_supplementary,
            model: rootnode,
        });
    },
    select_supplementary: function(contentnode) {
        var collection = new Models.ContentNodeCollection();
        var self = this;
        collection.fetch_nodes_by_ids_complete([contentnode.id], true).then(function(collection) {
            var model = collection.at(0);
            var actions =  {[self.model.id.toString()]: "BACK"};

            var newItem = new Models.StoryItemModel({
                item_type: "content_node",
                message_type: "resource",
                text: "",
                is_supplementary: true,
                node_id: model.get("node_id"),
                order: 0,
                actions:JSON.stringify(actions)
            });
            newItem.save().then(function(saved_story) {
                newItem.set("id", saved_story.id);
                newItem.set("contentnode", model);
                self.containing_list_view.collection.add(newItem);
                self.add_action("View Extra", saved_story.id);
                self.render_actions();
            });
        });
        this.content_modal.close();
    },
    load_preview: function(event){
        var file = _.find(this.node.files, function(i) { return !i.preset.supplementary; });
        var subtitles = _.filter(this.node.files, function(i) { return i.preset.subtitle; });
        new StoryPreviewFileView({
            node: this.model,
            model: file,
            subtitles: subtitles
        });
    },
});

var StoryActionView = BaseViews.BaseView.extend({
    template: require("./hbtemplates/story_item_actions.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,

    initialize: function(options) {
        this.action = options.action;
        this.item = options.item;
        this.editing = false;
        this.onedit = options.onedit;
        this.render();
    },
    events: {
        "click .edit_button": "edit",
        "click .submit_button": "submit",
        "click .preview_supplementary": "preview_supplementary"
    },
    render: function() {
        this.$el.html(this.template({
            action: this.action,
            editing: this.editing,
            item: this.item.toJSON()
        }, {
            data: this.get_intl_data()
        }));
    },
    edit: function() {
        this.editing = true;
        this.render();
    },
    submit: function() {
        var new_text = this.$(".edit_button_text").val();
        this.onedit(new_text, this.item.id);
        this.action.button = new_text;
        this.editing = false;
        this.render();
    },
    preview_supplementary: function() {
        var node = this.item.get("contentnode");
        node = (node.attributes)? node : new Models.ContentNodeModel(node);
        var file = _.find(node.get("files"), function(i) { return !i.preset.supplementary; });
        var subtitles = _.filter(node.get("files"), function(i) { return i.preset.subtitle; });
        new StoryPreviewFileView({
            node: node,
            model: file,
            subtitles: subtitles
        });
    }
});

var StoryContentModalView = BaseViews.BaseModalView.extend({
    template: require("./hbtemplates/story_content_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,

    initialize: function(options) {
        this.modal = true;
        this.render(this.close, {channel:State.current_channel.toJSON()});
        this.onselect = options.onselect;
        new StoryRelatedView({
            el: this.$(".modal-body"),
            modal : this,
            model:this.model,
            id_name: "id",
            container: this
        });
    },
    close: function() {
        if(this.modal){
            this.$(".modal").modal('hide');
        }
        this.remove();
        $("body").removeClass("modal-open");
    },
    onselect: function(model) {
        this.onselect(model);
    }
});


var StoryRelatedView = RelatedViews.RelatedView.extend({
    navigate_to_node: function(model, slideFromRight){
        if(this.relatedList){
            var placeholder = document.createElement("DIV");
            placeholder.className = "selector_placeholder";
            var new_list = new StoryRelatedList({
                model: model,
                collection: this.collection,
                container: this.container,
                related_view: this
            });
            this.$("#selector_box").append((slideFromRight)? new_list.el : placeholder);
            this.$("#selector_box").prepend((slideFromRight)? placeholder : new_list.el);

            var self = this;
            $(placeholder).animate({width: 'toggle'}, 150);
            this.relatedList.$el.animate({width: 'toggle'}, 150, function(){
                self.$el.find(".selector_placeholder").remove();
                self.relatedList.remove();
                delete self.relatedList;
                self.relatedList = new_list;
            });
        } else{
            this.relatedList = new StoryRelatedList({
                model: model,
                collection: this.collection,
                container: this.container,
                related_view: this
            });
            this.$("#selector_box").html(this.relatedList.el)
        }
    }
});


var StoryRelatedList = RelatedViews.RelatedList.extend({
    create_new_view:function(model){
        var new_view = new StoryRelatedItem({
            containing_list_view: this,
            model: model,
            container: this.container,
            collection: this.collection
        });
        this.views.push(new_view);
        return new_view;
    }
});

var StoryRelatedItem = RelatedViews.RelatedItem.extend({
    select_prerequisite:function(){
        this.container.onselect(this.model);
    }
});

var StoryPreviewFileView = BaseViews.BaseModalView.extend({
    modal: true,
    header: null,
    template: require("./hbtemplates/story_preview_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,
    initialize: function(options) {
        _.bindAll(this, 'create_preview');
        this.subtitles = options.subtitles;
        this.node = options.node;
        this.render();
        _.defer(this.create_preview);
    },
    render: function() {
        this.$el.html(this.template(null, {
            data: this.get_intl_data()
        }));
        $("body").append(this.el);
        this.$("#story_preview_modal").modal({show: true});
        this.$("#story_preview_modal").on("hidden.bs.modal", this.close);
    },
    create_preview: function(){
        var previewer = require('edit_channel/preview/views');
        previewer.render_preview(this.$("#preview_window"), this.model, this.subtitles, true, this.node.get('thumbnail_encoding') && this.node.get("thumbnail_encoding").base64, this.get_intl_data());
        if(this.subtitles.length){
            this.$("#preview_window video").get(0).textTracks[0].mode = "showing";
        }
    }
});

var StoryPreviewModalView = BaseViews.BaseModalView.extend({
    modal: true,
    header: null,
    template: require("./hbtemplates/story_preview_modal.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,
    initialize: function(options) {
        _.bindAll(this, 'toggle_fullscreen', 'exit_fullscreen');
        this.collection = options.collection;
        this.render(this.close, {});

        var first_item = this.collection.chain().sortBy("order").find(function(i) { return !i.get("is_supplementary"); }).value();
        this.switch_page(new Models.StoryItemModel({
            "contentnode": {
                "title": this.model.get("title"),
                "description": this.model.get("description")
            },
            "actions": JSON.stringify({[first_item.id]: "START"})
        }));
    },
    events: {
        'click .view_fullscreen': 'toggle_fullscreen'
    },
    switch_page: function(story_item) {
        this.startingView = new StoryPreviewView({
            model: story_item,
            el: this.$("#preview_window"),
            container: this
        });
    },
    navigate_to_page: function(id) {
        var story_item = this.collection.find(function(i) { return i.id.toString() === id.toString(); });
        this.switch_page(story_item);
    },
    toggle_fullscreen:function(){
        var elem = document.getElementById("preview_window_wrapper");

        if (!this.check_fullscreen()){
            this.$("#preview_window_wrapper").addClass('preview_on');
            this.$(".view_fullscreen").html("Hide Fullscreen");
            if (elem.requestFullscreen) {
              elem.requestFullscreen();
            } else if (elem.msRequestFullscreen) {
              elem.msRequestFullscreen();
            } else if (elem.mozRequestFullScreen) {
              elem.mozRequestFullScreen();
            } else if (elem.webkitRequestFullscreen) {
              elem.webkitRequestFullscreen();
            }
            $(document).on('webkitfullscreenchange', this.exit_fullscreen);
            $(document).on('mozfullscreenchange', this.exit_fullscreen);
            $(document).on('fullscreenchange', this.exit_fullscreen);
        }else{
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    },
    exit_fullscreen:function(){
        if (!this.check_fullscreen()){
            this.$("#preview_window_wrapper").removeClass('preview_on');
            this.$(".view_fullscreen").html("Show Fullscreen");
            $(document).off('webkitfullscreenchange');
            $(document).off('mozfullscreenchange');
            $(document).off('fullscreenchange');
            $(document).off('MSFullscreenChange');
        }
    },
    check_fullscreen: function() {
        return !((document.fullScreenElement !== undefined && document.fullScreenElement === null) ||
         (document.msFullscreenElement !== undefined && document.msFullscreenElement === null) ||
         (document.mozFullScreen !== undefined && !document.mozFullScreen) ||
         (document.webkitIsFullScreen !== undefined && !document.webkitIsFullScreen));
    }
});

var StoryPreviewView = BaseViews.BaseView.extend({
    template: require("./hbtemplates/story_preview.handlebars"),
    name: NAMESPACE,
    $trs: MESSAGES,
    initialize: function(options) {
        this.container = options.container;
        this.render();
    },
    events: {
        "click .navigation-button": "navigate",
    },
    render: function() {
        var node = this.model.get("contentnode");
        node = node && node.attributes || node;
        this.$el.html(this.template({
            item: this.model.toJSON(),
            node: node,
            buttons: JSON.parse(this.model.get("actions")),
            file: node && _.find(node.files, function(f) { return !f.preset.supplementary; })
        }, {
            data: this.get_intl_data()
        }));
    },
    navigate: function(event){
        this.container.navigate_to_page($(event.target).data('next'));
    }
});


module.exports = {
    StoryModalView:StoryModalView,
    StoryView: StoryView
}
