//
//  HelpView.sample.swift
//  Fixture for generate.test.mjs: a small HelpView that uses every helper the generator reads.
//

import SwiftUI

struct HelpView: View {
    /// The five reviews.
    private let reviews: [(collection: QuoteCollection, days: Int)] = [
        (.tomorrow, 1),
        (.nextWeek, 7),
        (.nextYear, 365),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                section("What it is") {
                    paragraph("A *method* for \"quotable\" quotes.")
                }

                section("The five reviews") {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(reviews, id: \.collection) { review in
                            if review.collection == .tomorrow {
                                // The first review is the day the quote is added.
                                reviewRow(review.collection, days: review.days, title: "Today", trailing: "day added")
                            } else {
                                reviewRow(review.collection, days: review.days)
                            }
                        }
                    }
                    paragraph("Counted from the day you add it.")
                }

                section("Getting quotes in", systemImage: "tray.and.arrow.down") {
                    topic("Capture") {
                        steps([
                            "Tap + (on a Mac, the **+** button).",
                            "Save.",
                        ])
                        bullets([
                            "See [the site](https://example.com/) \u{2014} it\u{2019}s free.",
                            "A back\\slash and a tab:\there.",
                        ])
                        bullets([
                            "A second list right after the first.",
                        ])
                    }
                    /* A block comment between topics. */
                    topic("Short form", "One paragraph only.")
                    topic("Details") {
                        subhead("What gets filled in")
                        paragraph("""
                            First line of a multi-line literal,
                            second line \
                            joined to this one.
                            """)
                        note("Never changes the schedule.")
                    }
                    .padding(.top, 4)
                }

                section("iCloud Sync", systemImage: "icloud") {
                    Divider()
                    Text("Quotes sync through iCloud.")
                }

                paragraph("[Mezmorize](https://example.com/) on GitHub.com")
            }
            .textSelection(.enabled)
            .frame(maxWidth: 600, alignment: .leading)
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 400)
        #endif
    }

    private func paragraph(_ text: LocalizedStringKey) -> some View {
        Text(text)
    }

    private func reviewRow(_ collection: QuoteCollection, days: Int, title: String? = nil, trailing: String? = nil) -> some View {
        Text(trailing ?? (days == 1 ? "1 day" : "\(days) days"))
    }
}
