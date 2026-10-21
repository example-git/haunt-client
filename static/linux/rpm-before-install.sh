#!/bin/sh
# Older Haunt RPMs registered an unowned alternatives link. Remove only that
# registration before RPM installs its own /usr/bin/haunt file.
if command -v alternatives >/dev/null 2>&1; then
    alternatives --remove haunt /opt/Haunt/haunt 2>/dev/null || :
fi
exit 0
