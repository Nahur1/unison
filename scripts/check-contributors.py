"""Check authorship against the two approved human accounts."""
import argparse
from pathlib import Path
import re
import subprocess
ROOT = Path(__file__).resolve().parents[1]
ALLOWED = {'51950495+nahur1@users.noreply.github.com', '63972210+reza-hashemian@users.noreply.github.com', 'nahur1@users.noreply.github.com', 'reza-hashemian@users.noreply.github.com'}
AI_NAME = re.compile(r'\b(claude|codex|chatgpt|openai|anthropic|copilot|gemini|gpt|bot)\b', re.I)
def validate(author, committer, message, author_name='', committer_name=''):
    errors = []
    if AI_NAME.search(author_name) or AI_NAME.search(committer_name):
        errors.append('AI author/committer names are forbidden')
    if author.lower() not in ALLOWED:
        errors.append('Unapproved author: ' + author)
    # GitHub web merges use this committer; it is never an approved author.
    if committer.lower() not in ALLOWED | {'noreply@github.com'}:
        errors.append('Unapproved committer: ' + committer)
    for line in message.splitlines():
        if re.match(r'^\s*co-authored-by\s*:', line, re.I):
            match = re.fullmatch(r'\s*Co-Authored-By:\s*[^<>\r\n]+<([^<>\s]+)>\s*', line, re.I)
            if not match or match[1].lower() not in ALLOWED or AI_NAME.search(line.split('<', 1)[0]):
                errors.append('Unapproved or malformed co-author: ' + line)
    return errors
def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT).decode('utf-8').strip()
def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--message-file')
    parser.add_argument('--rev', default='HEAD')
    args = parser.parse_args()
    failures = []
    if args.message_file:
        author = re.search(r'<([^<>]+)>', git('var', 'GIT_AUTHOR_IDENT'))[1]
        committer = re.search(r'<([^<>]+)>', git('var', 'GIT_COMMITTER_IDENT'))[1]
        failures = validate(author, committer, Path(args.message_file).read_text(encoding='utf-8'), git('var', 'GIT_AUTHOR_IDENT').split('<')[0], git('var', 'GIT_COMMITTER_IDENT').split('<')[0])
    else:
        for commit in git('rev-list', args.rev).splitlines():
            author, committer, author_name, committer_name, message = git('show', '-s', '--format=%ae%x00%ce%x00%an%x00%cn%x00%B', commit).split('\0', 4)
            failures.extend(commit + ': ' + error for error in validate(author, committer, message, author_name, committer_name))
    if failures:
        raise SystemExit('\n'.join(failures))
    print('Contributor identity check passed (Nahur1 / reza-hashemian).')
if __name__ == '__main__':
    main()
