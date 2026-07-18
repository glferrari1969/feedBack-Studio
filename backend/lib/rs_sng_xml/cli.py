from __future__ import annotations

import argparse
from .converter import sng_to_xml_file


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Convert Rocksmith 2014 .sng to XML without using .NET")
    parser.add_argument("input", help="Input .sng file")
    parser.add_argument("output", help="Output .xml file")
    parser.add_argument("--platform", choices=["pc", "mac"], default="pc")
    parser.add_argument("--arrangement", default="Lead")
    parser.add_argument("--title", default="")
    args = parser.parse_args(argv)
    sng_to_xml_file(args.input, args.output, args.platform, arrangement=args.arrangement, title=args.title)
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
