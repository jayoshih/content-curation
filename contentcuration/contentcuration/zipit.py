from bs4 import BeautifulSoup
from django.conf import settings
from django.http import HttpResponse, HttpResponseRedirect, HttpResponseNotFound
from django.template.loader import get_template
import os
import json
import markdown
import re
import sys
import tempfile
import zipfile

from contentcuration.models import ContentNode, Story, StoryItem, generate_file_on_disk_name
from contentcuration.html_writer import HTMLWriter
from le_utils.constants.file_types import MAPPING, THUMBNAIL
from le_utils.constants.exercises import CONTENT_STORAGE_PLACEHOLDER

reload(sys)
sys.setdefaultencoding('utf8')

THUMBNAIL_FORMATS = [k for k,v in MAPPING.items() if v==THUMBNAIL]

MESSAGE_TYPES = ["activity", "instructions", "message", "prompt", "reflection"]
CONTENT_NODE_TYPE = 'content_node'

def render_story(story):
    sorted_story_items = StoryItem.objects.filter(story=story).order_by('order')
    fh, temp_path = tempfile.mkstemp(suffix=".zip")
    with HTMLWriter(write_to_path=temp_path) as zipwriter:
        render_story_index(zipwriter, story, sorted_story_items.filter(is_supplementary=False).first())
        zipwriter.write_file(os.path.join(settings.BASE_DIR, "contentcuration", "static", "css", "zip.css"), filename='styles.css')
        for story_item in sorted_story_items:
            render_story_item(zipwriter, story, story_item)
    return temp_path


def render_story_index(zipwriter, story, first_story_item):
    template = get_template('stories/story_index.html')
    context =  {
        'story': story,
        'buttons': [{'href': str(first_story_item.id)+'.html', 'text': 'START', 'class': 'next-button'}],
    }
    item_html = template.render(context)
    zipwriter.write_index_contents(item_html.format(story.title))


def render_story_item(zipwriter, story, story_item):
    if story_item.item_type in MESSAGE_TYPES:
        render_message(zipwriter, story, story_item)

    elif story_item.item_type == CONTENT_NODE_TYPE:
        render_content_node(zipwriter, story, story_item)

    else:
        raise ValueError('UNRECOGNIZED story_item.item_type = ' + story_item.item_type)


def buttons_form_actions(actions):
    buttons = []
    for k, v in actions.items():
        if v == 'NEXT':
            button = {'href': str(k)+'.html',
                      'text': 'NEXT',
                      'class': 'next-button'}
        else:
            button = {'href': str(k)+'.html',
                      'text': v,
                      'class': 'optional-button'}
        buttons.append(button)
    return buttons

def add_images_to_zip(zipwriter, content):
    image_list = {}

    for match in re.finditer(ur'!\[(?:[^\]]*)]\(([^\)]+)\)', content):
        img_match = re.search('{}(/[^\s]+)(?:\s=([0-9\.]+)x([0-9\.]+))*'.format(CONTENT_STORAGE_PLACEHOLDER), match.group(1).encode('utf-8'))
        if img_match:

            # Add image files to zipwriter
            filename = img_match.group(1).split('/')[-1]
            checksum, ext = os.path.splitext(filename)
            fpath = generate_file_on_disk_name(checksum, filename)
            img_path = zipwriter.write_file(fpath, directory="img")

            # Add resizing data
            image_list.update({
                img_path: {
                    'width': img_match.group(2) and float(img_match.group(2)),
                    'height': img_match.group(3) and float(img_match.group(3)),
                }
            })
            content = content.replace(match.group(1), img_path)

    return content, image_list

def render_message(zipwriter, story, story_item):
    text, images = add_images_to_zip(zipwriter, story_item.text)
    html = markdown.markdown(text)
    soup = BeautifulSoup(html, 'html.parser')

    # Assign sizes
    for img in soup.find_all('img'):
        img['width'] = images[img['src']]['width']
        img['height'] = images[img['src']]['height']

    print 'in render_message', story_item.id, html, story_item.actions

    actions = json.loads(story_item.actions)
    buttons = buttons_form_actions(actions)

    template = get_template('stories/message_item.html')
    context =  {
        'head_title': 'Message story item',
        'meta_description': '',
        'message_type': story_item.message_type,
        'message_html': soup.renderContents(),
        'buttons': buttons,
    }
    item_html = template.render(context)
    filename = str(story_item.id)+'.html'
    zipwriter.write_contents(filename, item_html)


def render_content_node(zipwriter, story, story_item):
    html = markdown.markdown(story_item.text)
    cnode = ContentNode.objects.get(node_id=story_item.node_id)
    print 'in render_content_node', story_item.id, cnode.title, story_item.actions

    actions = json.loads(story_item.actions)
    buttons = buttons_form_actions(actions)


    # figure out path
    ############################################################################
    abs_path = None
    thumb_path = None

    for file_obj in cnode.files.all():

        if file_obj.file_format_id in THUMBNAIL_FORMATS:
            thumb_path = file_obj.file_on_disk
        elif file_obj.file_format_id in ["vtt", "srt"]:
            pass  # skip subs
        elif file_obj.file_format_id in ['perseus', 'svg', 'json', 'json']:
            pass  # skip anything else
        else:
            abs_path = file_obj.file_on_disk.name
            checksum = file_obj.checksum
            print 'abs_path=', abs_path
            rel_path = os.path.basename(abs_path)

    # figure out what kind of file it is
    ############################################################################
    kind = cnode.kind.kind
    if kind == 'video':
        template = get_template('stories/video_node.html')
        zipwriter.write_file(abs_path, rel_path)
    elif kind == 'audio':
        template = get_template('stories/audio_node.html')
        zipwriter.write_file(abs_path, rel_path)
    elif kind == 'document':
        template = get_template('stories/document_node.html')
        zipwriter.write_file(abs_path, rel_path)
    elif kind == 'html5':
        template = get_template('stories/html5_node.html')
        html5_zipfile = zipfile.ZipFile(abs_path)
        all_files = html5_zipfile.namelist()
        for filename in all_files:
            zipwriter.write_contents(filename, html5_zipfile.read(filename), directory=checksum)
    else:
        raise ValueError('UNRECOGNIZED kind = ' + kind)

    context =  {
        'kind': kind,
        'message_html': html,
        'head_title': cnode.title,
        'meta_description': cnode.description,
        'node': cnode,
        'rel_path': rel_path,
        'checksum': checksum,
        'thumb_path': thumb_path,
        'buttons': buttons,
    }
    item_html = template.render(context)
    filename = str(story_item.id)+'.html'
    zipwriter.write_contents(filename, item_html)
