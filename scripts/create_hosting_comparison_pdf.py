from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    KeepTogether,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "maitri-inventory-hosting-comparison.pdf"
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

NAVY = colors.HexColor("#102A43")
TEAL = colors.HexColor("#00897B")
GREEN = colors.HexColor("#DFF4EA")
AMBER = colors.HexColor("#FFF3D6")
INK = colors.HexColor("#1F2933")
MUTED = colors.HexColor("#52606D")
LINE = colors.HexColor("#D9E2EC")
PALE = colors.HexColor("#F5F7FA")

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(
    name="TitleCustom", parent=styles["Title"], fontName="Helvetica-Bold",
    fontSize=23, leading=28, textColor=NAVY, spaceAfter=7,
))
styles.add(ParagraphStyle(
    name="Subtitle", parent=styles["Normal"], fontName="Helvetica",
    fontSize=10.5, leading=15, textColor=MUTED, spaceAfter=14,
))
styles.add(ParagraphStyle(
    name="H1Custom", parent=styles["Heading1"], fontName="Helvetica-Bold",
    fontSize=15, leading=19, textColor=NAVY, spaceBefore=6, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="H2Custom", parent=styles["Heading2"], fontName="Helvetica-Bold",
    fontSize=11.5, leading=15, textColor=NAVY, spaceBefore=4, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="BodyCustom", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=9.2, leading=13, textColor=INK, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="Small", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.5, leading=10, textColor=MUTED,
))
styles.add(ParagraphStyle(
    name="Cell", parent=styles["BodyText"], fontName="Helvetica",
    fontSize=7.4, leading=9.3, textColor=INK,
))
styles.add(ParagraphStyle(
    name="CellBold", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.5, leading=9.4, textColor=INK,
))
styles.add(ParagraphStyle(
    name="Header", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=7.5, leading=9.4, textColor=colors.white,
))
styles.add(ParagraphStyle(
    name="Callout", parent=styles["BodyText"], fontName="Helvetica-Bold",
    fontSize=10, leading=14, textColor=NAVY,
))


def p(text, style="BodyCustom"):
    return Paragraph(text, styles[style])


def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.line(doc.leftMargin, 0.5 * inch, letter[0] - doc.rightMargin, 0.5 * inch)
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(doc.leftMargin, 0.32 * inch, "Maitri Diamonds - Hosting Decision")
    canvas.drawRightString(letter[0] - doc.rightMargin, 0.32 * inch, f"Page {doc.page}")
    canvas.restoreState()


def compare_table():
    rows = [
        [p("Area", "Header"), p("Render Hosting", "Header"), p("Always-On Office PC", "Header")],
        [p("Monthly total"), p("About $59-62"), p("About $27-30 plus electricity")],
        [p("Backend location"), p("Managed cloud data center"), p("Dedicated NY office PC")],
        [p("Database"), p("Same Supabase Pro database"), p("Same Supabase Pro database")],
        [p("Sleep behavior"), p("Paid services do not sleep"), p("Runs only while PC, Windows, and internet stay available")],
        [p("NY office outage"), p("Other branches keep working"), p("All branches lose the app if the central PC or NY internet fails")],
        [p("Power / Windows restart"), p("No office impact"), p("Can interrupt all branches unless a UPS and restart policy are used")],
        [p("Security"), p("Managed public HTTPS"), p("Cloudflare Tunnel can hide the PC with no inbound ports")],
        [p("Scale later"), p("Upgrade CPU/RAM in minutes"), p("Replace or upgrade hardware")],
        [p("Updates / rollback"), p("Git deployment and hosted logs"), p("Manual update and local log review")],
        [p("Best use"), p("Business-critical, low-maintenance operation"), p("Lowest-cost launch with a reliable dedicated PC")],
    ]
    table = Table(rows, colWidths=[1.2 * inch, 2.45 * inch, 2.65 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("BACKGROUND", (0, 1), (-1, -1), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


def cost_table():
    rows = [
        [p("Option", "Header"), p("Monthly", "Header"), p("One-time / annual", "Header"), p("Use case", "Header")],
        [p("Supabase + office PC + Cloudflare Tunnel"), p("$27-30"), p("Domain: about $12-20/year. Optional UPS / mini PC."), p("Lowest cost. A dedicated NY PC can be kept on and monitored.")],
        [p("Supabase + Render Standard backend + Render frontend"), p("$59-62"), p("Domain: about $12-20/year."), p("Daily business system where NY power or office internet should not stop Chicago and LA.")],
        [p("Office PC now, Render later"), p("$27-30 now"), p("Same domain carries forward."), p("Practical staged path while usage and reliability needs are proven.")],
    ]
    table = Table(rows, colWidths=[1.85 * inch, 0.75 * inch, 1.75 * inch, 2.0 * inch], repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("GRID", (0, 0), (-1, -1), 0.35, LINE),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return table


doc = SimpleDocTemplate(
    str(OUTPUT), pagesize=letter, rightMargin=0.6 * inch, leftMargin=0.6 * inch,
    topMargin=0.6 * inch, bottomMargin=0.7 * inch,
)
story = []
story += [
    p("Maitri Inventory: Why We Need Hosting", "TitleCustom"),
    p("A simple decision guide for keeping the NY, Chicago, and Los Angeles system working together every day.", "Subtitle"),
    p("Straight answer", "H1Custom"),
]

callout = Table([[p("Use Supabase Pro for the permanent database and use Render for the live application. This costs about $59-62/month in total. It is the right choice if the system must keep working when the NY office PC, power, or internet has a problem.", "Callout")]], colWidths=[7.3 * inch])
callout.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), GREEN),
    ("BOX", (0, 0), (-1, -1), 0.7, TEAL),
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 11),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
]))
story += [callout, Spacer(1, 12)]

story += [p("Why a database alone is not enough", "H2Custom")]
story += [p("Think of the database as a locked filing cabinet. It stores the stock, users, requests, and history. It does not run the screen, read invoices, check passwords, stop two reps taking the same stone, or send live updates to the other branches.")]
story += [p("The backend is the working part of the system. It is the service that sits between staff and the database. It checks each request, applies the rules, and keeps the three branches in sync. Staff computers must talk to this service, not directly to the database. Direct database access would put the database password on staff computers and create serious security and data mistakes.")]
story += [p("Why Render is required for a reliable system", "H2Custom")]
story += [p("Render is simply a company that keeps the backend and app running in a professional data center. It is not tied to any Maitri office computer. If the NY office loses power, Windows restarts, or its internet goes down, Chicago and LA can still use the system. That is why Render costs more: you are paying to remove the NY office PC as the weak point.")]
story += [p("The honest truth about not using Render", "H2Custom")]
story += [p("You can save money by running the backend on one NY office PC. It will work when that PC and the NY internet are working. But every branch depends on that one machine. A Windows update, power cut, router problem, full hard drive, or someone shutting the PC down makes the system unavailable for everyone. This is acceptable only if Maitri accepts occasional downtime and assigns someone to maintain that computer. It is not the best long-term choice for a daily three-branch business system.")]

story += [p("Current data size", "H2Custom")]
story += [p("The verified current stock contains 30,150 loose diamonds and 701 jewelry pieces, for 30,851 records. The two original source spreadsheets total about 5.25 MB. The indexed database snapshot is expected to remain in the tens of megabytes, not gigabytes. Daily stock replacement does not store a new full copy each day; requests and audit history add comparatively little data.")]

story += [Spacer(1, 7), p("How the two choices work", "H2Custom")]
diagram = Table([
    [p("RENDER: RECOMMENDED", "Header"), p("OFFICE PC: LOWER-COST FALLBACK", "Header")],
    [p("All staff PCs -> Render runs the app -> Supabase Pro stores the data"), p("All staff PCs -> secure tunnel -> one NY PC runs the app -> Supabase Pro stores the data")],
], colWidths=[3.65 * inch, 3.65 * inch])
diagram.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (0, 0), NAVY), ("BACKGROUND", (1, 0), (1, 0), TEAL),
    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
    ("BACKGROUND", (0, 1), (-1, 1), PALE),
    ("GRID", (0, 0), (-1, -1), 0.35, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
]))
story += [diagram, PageBreak(), p("Detailed comparison", "H1Custom"), compare_table(), PageBreak()]

story += [p("Costs and Operating Considerations", "H1Custom"), cost_table(), Spacer(1, 14)]

story += [p("Why Render works", "H2Custom")]
story += [p("Render removes the office PC from the system. There is no person in NY who must remember to keep a PC on. There is no Windows update stopping all branches. It gives one stable web address, secure HTTPS, simple updates, and simple error checking. Paid Render services stay awake.")]
story += [p("What Render cannot promise", "H2Custom")]
story += [p("Render still needs the internet. It is not magic and the basic paid plan is not a special enterprise contract with guaranteed compensation for downtime. But for this size of business, it is far more dependable than one office computer.")]

story += [p("Why the office PC option can work", "H2Custom")]
story += [p("It is the cheapest option. A good dedicated PC in NY can run the backend and handle PDFs. Cloudflare Tunnel gives it a safe web address without opening ports on the office router.")]
story += [p("Why the office PC option can fail", "H2Custom")]
story += [p("It is one machine serving every branch. If the PC is off, frozen, restarting, infected, full, or disconnected, the app is down for everyone. A UPS helps with short power cuts, but it does not solve PC failure or internet failure. Choose this only to reduce cost, not because it is more reliable.")]

recommend = Table([[p("Recommendation: Use Supabase Pro plus Render from the beginning. The extra about $32/month is cheaper than losing sales time across three branches because one NY office PC or internet connection fails. Use the office-PC option only as a temporary budget fallback.", "Callout")]], colWidths=[7.3 * inch])
recommend.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), AMBER), ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#D99A20")),
    ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ("TOPPADDING", (0, 0), (-1, -1), 11), ("BOTTOMPADDING", (0, 0), (-1, -1), 11),
]))
story += [recommend, Spacer(1, 13)]

story += [p("Simple word guide", "H2Custom")]
story += [p("Database: the locked place where the business data is stored. Backend: the working service that checks rules before touching the database. Hosting: paying a company to keep that working service online. HTTPS: the locked connection used between staff computers and the system. Tunnel: a secure path from the internet to an office PC without opening the office network to everyone.", "Small")]
story += [p("Source notes", "H2Custom")]
story += [p("Supabase Pro is listed from $25/month, includes 8 GB disk, and lists additional general-purpose disk at $0.125 per GB per month. Supabase paid projects provide daily backups retained for 7 days. Render lists Starter at $7/month and Standard at $25/month; paid services do not spin down. Cloudflare Tunnel uses outbound-only encrypted connections and can avoid inbound ports. Pricing may change; verify checkout totals before payment.", "Small")]
story += [p("References: supabase.com/pricing | supabase.com/docs/guides/platform/manage-your-usage/disk-size | render.com/pricing | render.com/docs/faq | developers.cloudflare.com/tunnel/", "Small")]

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(OUTPUT)
