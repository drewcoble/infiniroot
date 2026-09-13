import { useState } from 'react';
import { useConvexAuth } from 'convex/react';
import { Stack as RouterStack, useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import { useMyAuctionSeasons, type LinkedSeason } from '@shared-core/useMyAuctionSeasons';
import { useSignIn } from '@shared-core/useSignIn';
import { AppText, Button, Card, Loading, Screen, Stack, colors } from '@/components/ui';

export default function IndexScreen() {
  const { isAuthenticated, isLoading } = useConvexAuth();

  return (
    <>
      <RouterStack.Screen options={{ title: 'infinifaab' }} />
      {isLoading ? <Loading /> : isAuthenticated ? <SeasonList /> : <SignInForm />}
    </>
  );
}

function SignInForm() {
  const { submit, submitting, error } = useSignIn();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <Screen style={styles.center}>
      <Stack gap={12} style={styles.form}>
        <AppText variant="title">Sign in</AppText>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Email"
          placeholderTextColor={colors.textDimmed}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={styles.input}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          placeholderTextColor={colors.textDimmed}
          secureTextEntry
          style={styles.input}
        />
        {error && <AppText style={{ color: colors.danger }}>{error}</AppText>}
        <Button
          title="Sign in"
          loading={submitting}
          disabled={!email || !password}
          onPress={() => void submit(email, password)}
        />
        <AppText variant="dimmed">
          Uses the same account as the infinifaab web app - create one there first if you
          don&apos;t have one yet.
        </AppText>
      </Stack>
    </Screen>
  );
}

function SeasonList() {
  const router = useRouter();
  const seasons = useMyAuctionSeasons();

  if (seasons === undefined) {
    return <Loading />;
  }

  return (
    <Screen>
      <FlatList<LinkedSeason>
        contentContainerStyle={styles.listContent}
        data={seasons}
        keyExtractor={(season) => season._id}
        ListHeaderComponent={
          <AppText variant="title" style={styles.listHeader}>
            Your leagues
          </AppText>
        }
        ListEmptyComponent={
          <AppText variant="dimmed">No leagues yet - connect one on the web app first.</AppText>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              router.push({ pathname: '/season/[seasonId]', params: { seasonId: item._id } })
            }
          >
            <Card style={styles.seasonCard}>
              <AppText numberOfLines={1}>{item.name}</AppText>
              <AppText variant="dimmed">
                {item.year} · {item.teamCount} teams · {item.scoring}
              </AppText>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: {
    justifyContent: 'center',
  },
  form: {
    padding: 24,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 16,
  },
  listContent: {
    padding: 16,
    gap: 8,
  },
  listHeader: {
    marginBottom: 8,
  },
  seasonCard: {
    gap: 4,
  },
});
