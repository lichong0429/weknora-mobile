from PIL import Image, ImageDraw

# Generate 512x512 and 192x192 icons from SVG-like spec
for size in [512, 192]:
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    radius = int(size * 96 / 512)  # rx=96 on 512 canvas
    # Draw blue rounded rect background
    draw.rounded_rectangle([0, 0, size, size], radius=radius, fill=(37, 99, 235, 255))
    # White bars: positions relative to 512
    bar1 = [int(size*160/512), int(size*144/512), int(size*(160+192)/512), int(size*(144+32)/512)]
    bar2 = [int(size*160/512), int(size*240/512), int(size*(160+192)/512), int(size*(240+32)/512)]
    bar3 = [int(size*160/512), int(size*336/512), int(size*(160+128)/512), int(size*(336+32)/512)]
    draw.rectangle(bar1, fill=(255,255,255,255))
    draw.rectangle(bar2, fill=(255,255,255,255))
    draw.rectangle(bar3, fill=(255,255,255,255))
    # Light blue circle
    cx, cy, r = int(size*368/512), int(size*352/512), int(size*40/512)
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(96, 165, 250, 255))
    # Small white bar in circle
    bar4 = [int(size*355/512), int(size*352/512), int(size*(355+26)/512), int(size*(352+10)/512)]
    draw.rectangle(bar4, fill=(255,255,255,255))
    img.save(f'icon-{size}x{size}.png')

print('Icons generated')
