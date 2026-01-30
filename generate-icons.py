#!/usr/bin/env python3
"""Generate PNG icons for PWA by recreating the design with PIL."""

from PIL import Image, ImageDraw, ImageFont
import os
import math

# Icon sizes needed for PWA
ICON_SIZES = [
    16, 32,           # Favicon
    72, 96, 128, 144, # Android/Chrome
    192, 384, 512,    # PWA Required
]

def create_gradient(size, color1, color2):
    """Create a diagonal gradient from top-left to bottom-right."""
    img = Image.new('RGB', (size, size))
    pixels = img.load()

    for y in range(size):
        for x in range(size):
            # Diagonal gradient factor
            factor = (x + y) / (2 * size - 2) if size > 1 else 0

            r = int(color1[0] + (color2[0] - color1[0]) * factor)
            g = int(color1[1] + (color2[1] - color1[1]) * factor)
            b = int(color1[2] + (color2[2] - color1[2]) * factor)

            pixels[x, y] = (r, g, b)

    return img


def draw_rounded_rect(draw, xy, radius, fill, outline=None, outline_width=1):
    """Draw a rounded rectangle."""
    x1, y1, x2, y2 = xy
    r = min(radius, (x2-x1)//2, (y2-y1)//2)

    # Draw rounded rectangle using pieslice and rectangles
    draw.rectangle([x1+r, y1, x2-r, y2], fill=fill, outline=None)
    draw.rectangle([x1, y1+r, x2, y2-r], fill=fill, outline=None)

    # Draw corners
    draw.pieslice([x1, y1, x1+2*r, y1+2*r], 180, 270, fill=fill)
    draw.pieslice([x2-2*r, y1, x2, y1+2*r], 270, 360, fill=fill)
    draw.pieslice([x1, y2-2*r, x1+2*r, y2], 90, 180, fill=fill)
    draw.pieslice([x2-2*r, y2-2*r, x2, y2], 0, 90, fill=fill)

    if outline:
        # Draw outline
        draw.arc([x1, y1, x1+2*r, y1+2*r], 180, 270, fill=outline, width=outline_width)
        draw.arc([x2-2*r, y1, x2, y1+2*r], 270, 360, fill=outline, width=outline_width)
        draw.arc([x1, y2-2*r, x1+2*r, y2], 90, 180, fill=outline, width=outline_width)
        draw.arc([x2-2*r, y2-2*r, x2, y2], 0, 90, fill=outline, width=outline_width)
        draw.line([x1+r, y1, x2-r, y1], fill=outline, width=outline_width)
        draw.line([x1+r, y2, x2-r, y2], fill=outline, width=outline_width)
        draw.line([x1, y1+r, x1, y2-r], fill=outline, width=outline_width)
        draw.line([x2, y1+r, x2, y2-r], fill=outline, width=outline_width)


def create_icon(size):
    """Create icon at specified size."""
    # Colors from SVG
    bg_color1 = (0, 105, 148)    # #006994
    bg_color2 = (0, 24, 37)      # #001825
    card_color = (255, 254, 249) # #FFFEF9
    turquoise = (64, 224, 208)   # #40E0D0
    text_color = (0, 105, 148)   # #006994
    red = (227, 93, 93)          # #E35D5D
    dark = (27, 40, 56)          # #1B2838

    # Create gradient background
    img = create_gradient(size, bg_color1, bg_color2)

    # Create RGBA image for rounded corners
    final = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)

    # Draw rounded background mask
    corner_radius = int(size * 80 / 512)  # Scaled from 80px at 512
    draw_rounded_rect(mask_draw, [0, 0, size-1, size-1], corner_radius, fill=255)

    # Paste gradient with mask
    final.paste(img, mask=mask)

    draw = ImageDraw.Draw(final)

    # Scale factors
    scale = size / 512

    # Card dimensions (from SVG: x="140" y="100" width="232" height="312" rx="20")
    card_x = int(140 * scale)
    card_y = int(100 * scale)
    card_w = int(232 * scale)
    card_h = int(312 * scale)
    card_radius = int(20 * scale)
    card_stroke = max(1, int(4 * scale))

    # Draw card
    draw_rounded_rect(draw,
                     [card_x, card_y, card_x + card_w, card_y + card_h],
                     card_radius, fill=card_color, outline=turquoise, outline_width=card_stroke)

    # Try to get a font for the D letter
    font_size = int(180 * scale)
    small_font_size = int(40 * scale)

    try:
        # Try different fonts
        for font_name in ['Georgia', 'Times New Roman', 'DejaVu Serif', 'C:\\Windows\\Fonts\\times.ttf', 'C:\\Windows\\Fonts\\georgia.ttf']:
            try:
                font = ImageFont.truetype(font_name, font_size)
                break
            except:
                pass
        else:
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()

    # Draw D letter centered in card
    text = "D"
    # Get text bounding box
    if hasattr(font, 'getbbox'):
        bbox = font.getbbox(text)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
    else:
        text_width = int(100 * scale)
        text_height = int(140 * scale)

    text_x = int(256 * scale) - text_width // 2
    text_y = int(300 * scale) - text_height

    draw.text((text_x, text_y), text, fill=text_color, font=font)

    # Draw suit symbols if size is large enough (skip for very small icons)
    if size >= 64:
        try:
            symbol_font = ImageFont.truetype('C:\\Windows\\Fonts\\segoeui.ttf', small_font_size)
        except:
            symbol_font = font

        # Suit positions (from SVG)
        # Heart top-left: x="180" y="160"
        # Spade top-right: x="332" y="160"
        # Diamond bottom-left: x="180" y="390"
        # Club bottom-right: x="332" y="390"

        symbols = [
            ('\u2665', int(180 * scale), int(160 * scale), red),       # Heart
            ('\u2660', int(332 * scale), int(160 * scale), dark),      # Spade
            ('\u2666', int(180 * scale), int(390 * scale), red),       # Diamond
            ('\u2663', int(332 * scale), int(390 * scale), dark),      # Club
        ]

        for symbol, x, y, color in symbols:
            try:
                draw.text((x - small_font_size//2, y - small_font_size), symbol, fill=color, font=symbol_font)
            except:
                pass

    # Draw decorative wave at bottom (simplified)
    if size >= 64:
        wave_y = int(450 * scale)
        wave_color = (64, 224, 208, 76)  # #40E0D0 with 0.3 opacity

        # Create wave overlay
        wave = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        wave_draw = ImageDraw.Draw(wave)

        # Simple curved wave using polygon
        points = []
        for x in range(size + 1):
            # Sine wave pattern
            y_offset = int(30 * scale * math.sin(x * 2 * math.pi / size))
            y = wave_y + y_offset
            points.append((x, y))

        # Close the polygon at bottom
        points.append((size, size))
        points.append((0, size))

        wave_draw.polygon(points, fill=wave_color)

        # Apply mask to keep rounded corners
        wave_masked = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        wave_masked.paste(wave, mask=mask)

        final = Image.alpha_composite(final, wave_masked)

    return final


def generate_icons():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    icons_dir = os.path.join(base_dir, 'icons')

    for size in ICON_SIZES:
        output_path = os.path.join(icons_dir, f'icon-{size}x{size}.png')
        print(f"Generating {size}x{size} icon...")

        icon = create_icon(size)
        icon.save(output_path, 'PNG', optimize=True)

    print(f"\nGenerated {len(ICON_SIZES)} icons successfully!")
    return True


if __name__ == '__main__':
    generate_icons()
