#!/bin/sh
# Older installers removed the shared launcher after unpacking their successor.
# Restore the package's exact symlink after those removal scriptlets finish.
if [ ! -e /usr/bin/haunt ] && [ ! -L /usr/bin/haunt ] && [ -x /opt/Haunt/haunt ]; then
    ln -s /opt/Haunt/haunt /usr/bin/haunt
fi
for directory in lib plugins pipewire spa/support spa pipewire-config; do
    rmdir "/opt/Haunt/resources/native/linux/$directory" 2>/dev/null || :
done
exit 0
